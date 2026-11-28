import { codecStringFromSps, splitAnnexB, nalType, concatBytes } from "./annexb.js";
// H.264 参考帧不能丢，只在 rAF 中限绘制帧率。
const TARGET_RENDER_FPS = 60;
const VSYNC_SLACK_MS = 4;
export function createUseH264Canvas(React, canvasRuntime) {
  const { useEffect } = React;
  const { fitCanvasToFrame, getMediaContext, watchStageSize, watchCanvasVisibility } = canvasRuntime;
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
      let attemptController = null;
      let stallTimer = null;
      let bytesReceived = 0;
      let endedCleanly = false;
      let endReason: "unknown" | "visibility-cancel" | "watchdog" | "eof" | "fetch-error" | "http-error" | "no-body" | "decoder-init-error" | "read-error" = "unknown";
      let attemptStartedAt = 0;
      let httpStatus: number | undefined;
      let lastByteAt: number | undefined;
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
      // 面板不可见时暂停取流/解码；恢复可见时重新取流并等下一个 IDR。
      let paused = false;
      let resumeWaiters = [];
      const waitForResume = () => paused ? new Promise<void>((resolve) => { resumeWaiters.push(resolve); }) : Promise.resolve();
      const releaseResumeWaiters = () => {
        const waiters = resumeWaiters;
        resumeWaiters = [];
        for (const resolve of waiters) resolve();
      };
      const setVisible = (visible) => {
        if (cancelled || visible === !paused) return;
        paused = !visible;
        console.info(`[mobile-stream] ${new Date().toISOString()} ${paused ? "paused" : "resumed"}`);
        if (!paused) {
          releaseResumeWaiters();
          return;
        }
        endReason = "visibility-cancel";
        needsKeyframe = true;
        // 掐断当前读流与还没回来的取流：解码循环会退出，重连循环改成等可见再取流。
        attemptController?.abort();
        void cancelReader(reader);
      };
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
        // 不可见时不排绘制：解码器吐出来的帧由下一个可见帧替换，避免后台空转 rAF。
        if (rafId !== 0 || cancelled || paused) return;
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
        // 退避计时器可能在暂停之后才到点：这一轮直接跳过，别白取一次流。
        if (paused) return;
        // 同一个 URL 自动重连不会重挂 hook，新一轮首帧仍须恢复播放状态。
        reportedPlaying = false;
        report("connecting");
        endedCleanly = false;
        endReason = "unknown";
        attemptStartedAt = performance.now();
        httpStatus = undefined;
        lastByteAt = undefined;
        // 每次取流一条独立信号：暂停时只掐断这一次，不影响外层取消语义。
        const attempt = new AbortController();
        attemptController = attempt;
        const relayAbort = () => attempt.abort();
        controller.signal.addEventListener("abort", relayAbort, { once: true });
        if (controller.signal.aborted) attempt.abort();
        let response;
        try {
          response = await fetch(streamUrl, { cache: "no-store", signal: attempt.signal });
        } catch (error) {
          if (cancelled || paused || attempt.signal.aborted) return;
          endReason = "fetch-error";
          report("error", `取流失败：${error?.message ?? error}`);
          return;
        } finally {
          controller.signal.removeEventListener("abort", relayAbort);
          if (attemptController === attempt) attemptController = null;
        }
        if (cancelled) {
          await cancelReader(response.body);
          return;
        }
        if (paused) {
          await cancelReader(response.body);
          return;
        }
        if (!response.ok) {
          endReason = "http-error";
          httpStatus = response.status;
          const detail = await response.text().catch(() => "");
          if (cancelled) return;
          report("error", `取流失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 160)}` : ""}`);
          return;
        }
        if (response.body === null) {
          endReason = "no-body";
          report("error", "响应没有可读的流");
          return;
        }
        const activeReader = response.body.getReader();
        reader = activeReader;
        const STALL_TIMEOUT_MS = 3e3;
        const readStartedAt = performance.now();
        // reader.cancel() 也会结束 read()；不要把看门狗误记成对端 EOF。
        const markReadEnd = (reason: "eof" | "read-error") => {
          if (!paused && endReason !== "watchdog" && endReason !== "visibility-cancel") endReason = reason;
        };
        stallTimer = setInterval(() => {
          if (cancelled || paused) return;
          if (performance.now() - (lastByteAt ?? readStartedAt) > STALL_TIMEOUT_MS) {
            endReason = "watchdog";
            report("connecting", "画面卡住了，正在重连…");
            void cancelReader(activeReader);
          }
        }, 500);
        try {
          for (; ; ) {
            // 不可见时不读流：既不占带宽，也不 push 进解码器。
            if (paused) break;
            const { done, value } = await activeReader.read();
            if (done && !cancelled) {
              endedCleanly = true;
              markReadEnd("eof");
            }
            if (cancelled || done || paused) break;
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
                    endReason = "decoder-init-error";
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
          if (!cancelled && !paused && !attempt.signal.aborted) {
            markReadEnd("read-error");
            report("error", `读取流失败：${error?.message ?? error}`);
          }
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
          if (cancelled) return;
          // 不可见时不取流：连重连都不发，等恢复可见再继续。
          // 可见时不额外等一拍，取流仍然是同步发起的。
          if (paused) {
            await waitForResume();
            if (cancelled) return;
          }
          const before = bytesReceived;
          await run();
          if (cancelled) return;
          // 这一轮是因为不可见被掐断的，不算断线，也不走退避节奏。
          if (paused) continue;
          const healthy = bytesReceived > before;
          if (healthy) reconnectDelay = RECONNECT_BASE_MS;
          // Host 重建流会正常结束旧响应；有过数据时走 150ms 快速重连。
          const waitMs = healthy && endedCleanly ? RECONNECT_FAST_MS : reconnectDelay;
          const now = performance.now();
          // 只记录诊断所需的数值，不输出流 URL、凭据或异常正文。
          console.info(`[mobile-stream] ${new Date().toISOString()} reconnect ${JSON.stringify({
            reason: endReason,
            httpStatus,
            attemptMs: Math.round(now - attemptStartedAt),
            bytes: bytesReceived - before,
            lastByteAgoMs: lastByteAt === undefined ? null : Math.round(now - lastByteAt),
            waitMs
          })}`);
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
      // 拿不到可见性 API 时 watchCanvasVisibility 不回调，行为与改造前一致。
      const unwatchVisibility = typeof watchCanvasVisibility === "function"
        ? watchCanvasVisibility(canvasElement, setVisible)
        : () => {
        };
      void runWithReconnect();
      return () => {
        cancelled = true;
        controller.abort();
        attemptController?.abort();
        finishReconnect?.();
        // 卡在 waitForResume 上的循环必须被放出来，否则清理后 Promise 永挂。
        releaseResumeWaiters();
        unwatchStage();
        unwatchVisibility();
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
