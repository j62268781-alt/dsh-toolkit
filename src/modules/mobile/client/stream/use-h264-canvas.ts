import { codecStringFromSps, splitAnnexB, nalType, concatBytes } from "./annexb.js";
// H.264 参考帧不能丢，只在 rAF 中限绘制帧率。
const TARGET_RENDER_FPS = 60;
const VSYNC_SLACK_MS = 4;
export function createUseH264Canvas(React, canvasRuntime) {
  const { useEffect } = React;
  const { fitCanvasToFrame, getMediaContext, watchStageSize } = canvasRuntime;
  function useH264Canvas(streamUrl, canvasRef, onState, frameSizeRef) {
    useEffect(() => {
      if (streamUrl === null) return void 0;
      let cancelled = false;
      const controller = new AbortController();
      let reconnectTimer = null;
      let finishReconnect = null;
      const cancelReader = (target) => {
        try { return Promise.resolve(target?.cancel()).catch(() => {}); }
        catch { return Promise.resolve(); }
      };
      let decoder = null;
      let reader = null;
      let stallTimer = null;
      let bytesReceived = 0;
      let endedCleanly = false;
      let carry = new Uint8Array(0);
      let timestamp = 0;
      let configured = false;
      let activeCodec = null;
      let sps = null;
      let pps = null;
      let needsKeyframe = true;
      let reportedPlaying = false;
      let pendingFrame = null;
      let rafId = 0;
      let lastDrawAt = 0;
      /** `detail` 只在部分状态出现（"connecting" 无详情），所以是可选的。 */
      const report = (state, detail?) => {
        if (!cancelled) onState(state, detail);
      };
      const drawLatestFrame = () => {
        rafId = 0;
        const frame = pendingFrame;
        pendingFrame = null;
        if (frame === null) return;
        const canvas = canvasRef.current;
        if (cancelled || canvas === null) {
          frame.close();
          return;
        }
        const now = performance.now();
        if (now - lastDrawAt < 1e3 / TARGET_RENDER_FPS - VSYNC_SLACK_MS) {
          // 等下一次 vsync，不能 close 掉还未画出的最新帧。
          pendingFrame = frame;
          rafId = requestAnimationFrame(drawLatestFrame);
          return;
        }
        lastDrawAt = now;
        const size = fitCanvasToFrame(canvas, frame.displayWidth, frame.displayHeight);
        if (size !== null) {
          const ctx2d = getMediaContext(canvas, size.downscale >= 1.5);
          if (ctx2d !== null) ctx2d.drawImage(frame, 0, 0, canvas.width, canvas.height);
        }
        frame.close();
        if (!reportedPlaying) {
          reportedPlaying = true;
          report("playing");
        }
      };
      const scheduleDraw = () => {
        if (rafId !== 0 || cancelled) return;
        rafId = requestAnimationFrame(drawLatestFrame);
      };
      const buildDecoder = (codec) => {
        if (decoder !== null) {
          try {
            decoder.close();
          } catch {
          }
        }
        decoder = new VideoDecoder({
          output: (frame) => {
            if (cancelled) {
              frame.close();
              return;
            }
            if (frameSizeRef !== void 0) {
              const prev = frameSizeRef.current;
              if (prev === null || prev === void 0 || prev.width !== frame.displayWidth || prev.height !== frame.displayHeight) {
                frameSizeRef.current = {
                  width: frame.displayWidth,
                  height: frame.displayHeight
                };
              }
            }
            if (pendingFrame !== null) pendingFrame.close();
            pendingFrame = frame;
            scheduleDraw();
          },
          error: (error) => {
            report("error", `解码器错误：${error?.message ?? String(error)}`);
          }
        });
        decoder.configure({
          codec,
          avc: { format: "annexb" },
          optimizeForLatency: true
        });
        needsKeyframe = true;
        configured = true;
        activeCodec = codec;
      };
      const run = async () => {
        report("connecting");
        endedCleanly = false;
        let response;
        try {
          response = await fetch(streamUrl, { cache: "no-store", signal: controller.signal });
        } catch (error) {
          report("error", `取流失败：${error?.message ?? error}`);
          return;
        }
        if (cancelled) {
          await cancelReader(response.body);
          return;
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          if (cancelled) return;
          report("error", `取流失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 160)}` : ""}`);
          return;
        }
        if (response.body === null) {
          report("error", "响应没有可读的流");
          return;
        }
        const activeReader = response.body.getReader();
        reader = activeReader;
        const STALL_TIMEOUT_MS = 3e3;
        let lastByteAt = performance.now();
        stallTimer = setInterval(() => {
          if (cancelled) return;
          if (performance.now() - lastByteAt > STALL_TIMEOUT_MS) {
            report("connecting", "画面卡住了，正在重连…");
            void cancelReader(activeReader);
          }
        }, 500);
        try {
          for (; ; ) {
            const { done, value } = await activeReader.read();
            if (done && !cancelled) {
              endedCleanly = true;
            }
            if (cancelled || done) break;
            lastByteAt = performance.now();
            bytesReceived += value?.byteLength ?? 0;
            const { units, rest } = splitAnnexB(carry, value);
            carry = rest;
            for (const unit of units) {
              const type = nalType(unit);
              if (type === 7) {
                const codec = codecStringFromSps(
                  new Uint8Array(unit.buffer, unit.byteOffset, unit.length)
                );
                if (!configured || decoder.state === "closed") {
                  try {
                    buildDecoder(codec);
                  } catch (error) {
                    report("error", `解码器初始化失败：${error?.message ?? error}`);
                    return;
                  }
                }
                activeCodec = codec;
                sps = unit;
                continue;
              }
              if (type === 8) {
                pps = unit;
                continue;
              }
              if (!configured || activeCodec === null) continue;
              if (type !== 1 && type !== 5) continue;
              if (decoder.state === "closed") {
                try {
                  buildDecoder(activeCodec);
                } catch {
                  continue;
                }
              }
              const isKey = type === 5;
              if (needsKeyframe && !isKey) continue;
              if (isKey) needsKeyframe = false;
              timestamp += 33333;
              // WebCodecs 的关键帧访问单元必须同时携带 SPS/PPS。
              const payload = isKey && sps !== null && pps !== null ? concatBytes(sps, pps, unit) : unit;
              try {
                decoder.decode(
                  new EncodedVideoChunk({
                    type: isKey ? "key" : "delta",
                    timestamp,
                    data: payload
                  })
                );
              } catch (error) {
                needsKeyframe = true;
                report("error", `解码失败：${error?.message ?? error}`);
              }
            }
          }
        } catch (error) {
          if (!cancelled) report("error", `读取流失败：${error?.message ?? error}`);
        } finally {
          if (stallTimer !== null) {
            clearInterval(stallTimer);
            stallTimer = null;
          }
          await cancelReader(activeReader);
          try { activeReader.releaseLock?.(); } catch {}
          if (reader === activeReader) reader = null;
        }
      };
      const RECONNECT_BASE_MS = 1e3;
      const RECONNECT_MAX_MS = 8e3;
      const RECONNECT_FAST_MS = 150;
      let reconnectDelay = RECONNECT_BASE_MS;
      const runWithReconnect = async () => {
        for (; ; ) {
          const before = bytesReceived;
          await run();
          if (cancelled) return;
          const healthy = bytesReceived > before;
          if (healthy) reconnectDelay = RECONNECT_BASE_MS;
          // Host 重建流会正常结束旧响应；有过数据时走 150ms 快速重连。
          const waitMs = healthy && endedCleanly ? RECONNECT_FAST_MS : reconnectDelay;
          report("connecting", "画面中断，正在重连…");
          await new Promise<void>((resolve) => {
            finishReconnect = () => {
              clearTimeout(reconnectTimer);
              reconnectTimer = null;
              finishReconnect = null;
              resolve();
            };
            reconnectTimer = setTimeout(finishReconnect, waitMs);
            if (cancelled) finishReconnect();
          });
          if (cancelled) return;
          if (waitMs !== RECONNECT_FAST_MS) {
            reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
          }
        }
      };
      if (typeof VideoDecoder === "undefined") {
        report(
          "error",
          "此浏览器不支持 WebCodecs，无法解码 H.264 画面。 用较新的 Chrome/Edge，或从 HTTPS 或 localhost 打开。"
        );
        return void 0;
      }
      const canvasElement = canvasRef.current;
      const unwatchStage = canvasElement === null ? () => {
      } : watchStageSize(canvasElement);
      void runWithReconnect();
      return () => {
        cancelled = true;
        controller.abort();
        finishReconnect?.();
        unwatchStage();
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        if (pendingFrame !== null) {
          pendingFrame.close();
          pendingFrame = null;
        }
        if (stallTimer !== null) {
          clearInterval(stallTimer);
          stallTimer = null;
        }
        void cancelReader(reader);
        try {
          if (decoder !== null && decoder.state !== "closed") decoder.close();
        } catch {
        }
      };
    }, [streamUrl]);
  }
  return useH264Canvas;
}
