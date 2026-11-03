import { stageOverlay } from "../presentation.js";
const MIN_SWIPE_DURATION_MS = 80;
const MAX_SWIPE_DURATION_MS = 600;
export function createStreamView(React, { api, prefix: PREFIX, useH264Canvas }) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useCallback } = React;
  function StreamView({
    deviceId,
    streamToken,
    format,
    frame,
    deviceKind,
    deviceState,
    frameSizeRef,
    onError
  }) {
    const [state, setState] = useState("idle");
    const [detail, setDetail] = useState(null);
    const canvasRef = useRef(null);
    const mediaRef = useRef(null);
    // 同批 pointerdown/up 必须同步读写起点，不能用异步 state。
    const gestureRef = useRef(null);
    // 重取期间保留上一帧；设备确认离线时再隐藏并清空画布。
    const [everPainted, setEverPainted] = useState(false);
    const offline = deviceState === "offline";
    const hasFrame = everPainted && !offline;
    useEffect(() => {
      if (!offline) return;
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, [offline]);
    const streamUrl = streamToken === null ? null : `${PREFIX}/stream/${encodeURIComponent(streamToken)}`;
    const isMjpeg = format === "mjpeg";
    useH264Canvas(
      isMjpeg || streamUrl === null ? null : streamUrl,
      canvasRef,
      (next, info) => {
        setState(next);
        if (next === "playing") setEverPainted(true);
        if (info !== void 0) setDetail(info);
        if (next === "error" && typeof info === "string") onError?.(info);
      },
      frameSizeRef
    );
    useEffect(() => {
      if (!isMjpeg) return void 0;
      setState(streamUrl === null ? "idle" : "connecting");
      return void 0;
    }, [isMjpeg, streamUrl]);
    const sendPointer = useCallback(
      async (event, phase) => {
        const element = isMjpeg ? mediaRef.current : canvasRef.current;
        if (element === null || deviceId === null) return;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const naturalWidth = isMjpeg ? element.naturalWidth : frameSizeRef.current.width;
        const naturalHeight = isMjpeg ? element.naturalHeight : frameSizeRef.current.height;
        if (!naturalWidth || !naturalHeight) return;
        const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
        const shownWidth = naturalWidth * scale;
        const shownHeight = naturalHeight * scale;
        const offsetX = (rect.width - shownWidth) / 2;
        const offsetY = (rect.height - shownHeight) / 2;
        const localX = event.clientX - rect.left - offsetX;
        const localY = event.clientY - rect.top - offsetY;
        if (localX < 0 || localY < 0 || localX > shownWidth || localY > shownHeight) return;
        const x = Math.round(localX / shownWidth * naturalWidth);
        const y = Math.round(localY / shownHeight * naturalHeight);
        if (phase === "down") {
          gestureRef.current = { x, y, at: event.timeStamp };
          return;
        }
        if (phase === "up") {
          const start = gestureRef.current;
          gestureRef.current = null;
          if (start === null) return;
          const dx = Math.abs(x - start.x);
          const dy = Math.abs(y - start.y);
          const threshold = Math.max(12, Math.round(naturalWidth * 0.02));
          try {
            if (dx > threshold || dy > threshold) {
              const heldMs = Math.max(0, event.timeStamp - start.at);
              const duration = Math.min(
                MAX_SWIPE_DURATION_MS,
                Math.max(MIN_SWIPE_DURATION_MS, Math.round(heldMs))
              );
              await api("control", {
                action: "swipe",
                x1: start.x,
                y1: start.y,
                x2: x,
                y2: y,
                duration
              });
            } else {
              await api("control", { action: "tap", x, y });
            }
          } catch (error) {
            onError?.(error?.message ?? String(error));
          }
        }
      },
      [deviceId, isMjpeg, onError]
    );
    const interactive = deviceId !== null && !offline && (state === "playing" || isMjpeg);
    const KEY_BATCH_MS = 40;
    // ASCII 发按键，Unicode 发文本；组合输入由 compositionend 提交。
    function translateKey(event) {
      const { key } = event;
      if (typeof key !== "string" || key === "") return null;
      if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return null;
      const named = {
        Enter: "enter",
        Backspace: "backspace",
        Delete: "forwarddelete",
        Escape: "escape",
        Tab: "tab",
        " ": "space",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Home: "home",
        End: "end",
        PageUp: "pageup",
        PageDown: "pagedown"
      };
      const name = named[key];
      if (name !== void 0) return { kind: "key", value: name };
      const chars = Array.from(key);
      if (chars.length !== 1) return null;
      const codePoint = key.codePointAt(0);
      if (codePoint >= 32 && codePoint < 127) {
        return { kind: "key", value: withModifiers(key.toLowerCase(), event) };
      }
      return { kind: "text", value: key };
    }
    function withModifiers(base, event) {
      if (base.length !== 1) return base;
      const parts = [];
      if (event.ctrlKey) parts.push("ctrl");
      if (event.metaKey) parts.push("cmd");
      if (event.altKey) parts.push("alt");
      if (event.shiftKey) parts.push("shift");
      if (parts.length === 0) return base;
      return [...parts, base].join("+");
    }
    const keyQueueRef = useRef([]);
    const keyTimerRef = useRef(null);
    const flushKeys = useCallback(async () => {
      keyTimerRef.current = null;
      const pending = keyQueueRef.current;
      keyQueueRef.current = [];
      if (pending.length === 0) return;
      const asciiKeys = pending.filter((item) => item.kind === "key").map((item) => item.value);
      const texts = pending.filter((item) => item.kind === "text").map((item) => item.value);
      try {
        if (asciiKeys.length > 0) await api("control", { action: "keys", keys: asciiKeys });
        for (const text of texts) await api("control", { action: "text", text });
      } catch (error) {
        onError?.(error?.message ?? String(error));
      }
    }, [onError]);
    const enqueueKey = useCallback(
      (item) => {
        const queue = keyQueueRef.current;
        queue.push(item);
        if (keyTimerRef.current === null) {
          keyTimerRef.current = setTimeout(() => void flushKeys(), KEY_BATCH_MS);
        }
      },
      [flushKeys]
    );
    useEffect(
      () => () => {
        if (keyTimerRef.current !== null) {
          clearTimeout(keyTimerRef.current);
          keyTimerRef.current = null;
        }
        keyQueueRef.current = [];
      },
      []
    );
    const keyboardHandlers = interactive ? {
      onKeyDown: (event) => {
        if (event.metaKey || event.ctrlKey) {
          const probe = translateKey(event);
          const EDIT_KEYS = new Set(["a", "c", "v", "x", "z", "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "cmd+a", "cmd+c", "cmd+v", "cmd+x", "cmd+z"]);
          if (probe === null || !EDIT_KEYS.has(probe.value)) return;
        }
        const item = translateKey(event);
        if (item === null) return;
        event.preventDefault();
        enqueueKey(item);
      },
      // 合成输入直到 compositionend 才有已提交的中文/Unicode 文本。
      onCompositionEnd: (event) => {
        const text = event.data;
        if (typeof text !== "string" || text === "") return;
        enqueueKey({ kind: "text", value: text });
      },
      onPaste: (event) => {
        const text = event.clipboardData?.getData("text");
        if (typeof text !== "string" || text === "") return;
        event.preventDefault();
        enqueueKey({ kind: "text", value: text });
      }
    } : {};
    const pointerHandlers = {
      onPointerDown: (e) => void sendPointer(e, "down"),
      onPointerUp: (e) => void sendPointer(e, "up"),
      onPointerCancel: () => {
        gestureRef.current = null;
      }
    };
    const media = isMjpeg ? <img
      ref={mediaRef}
      className="mbm-media"
      src={streamUrl ?? void 0}
      alt="设备画面"
      draggable={false}
      tabIndex={interactive ? 0 : void 0}
      onLoad={() => {
        setState("playing");
        setEverPainted(true);
      }}
      onError={() => {
        const message = "MJPEG 流加载失败，检查设备是否仍在线。";
        setState("error");
        onError?.(message);
      }}
      {...pointerHandlers}
      {...keyboardHandlers}
      style={{
        cursor: interactive ? "crosshair" : "default",
        touchAction: "none",
        // 保留布局，离线只隐藏画面。
        visibility: hasFrame ? "visible" : "hidden"
      }}
    /> : <canvas
      ref={canvasRef}
      className="mbm-media"
      tabIndex={interactive ? 0 : void 0}
      {...pointerHandlers}
      {...keyboardHandlers}
      style={{
        cursor: interactive ? "crosshair" : "default",
        touchAction: "none",
        // 重取不隐藏上一帧，首次绘制前才不显示。
        display: everPainted ? "block" : "none",
        // 离线保留尺寸，避免外壳塌陷。
        visibility: hasFrame ? "visible" : "hidden"
      }}
    />;
    // 保持外壳与 canvas DOM 稳定；外观切换只由 CSS 控制，不能重挂。
    const chassis = <div
      className="mbm-chassis"
      data-device-kind={deviceKind ?? "unknown"}
      data-media={everPainted ? "on" : "off"}
    >
      {media}
      {
        /* 侧键：电源在右、音量上/下在左，绝对定位在机身内边距带里 */
      }
      <i className="mbm-sideKey" data-side="power" />
      <i className="mbm-sideKey" data-side="volumeUp" />
      <i className="mbm-sideKey" data-side="volumeDown" />
      {
        /* 前置开孔：iOS 灵动岛 / Android 挖孔，由 data-device-kind 决定显隐 */
      }
      <i className="mbm-island" />
      <i className="mbm-punch" />
    </div>;
    const overlay = stageOverlay({ state, detail, hasFrame, deviceState });
    return <div className="mbm-stage" data-frame={frame}>
      {chassis}
      {overlay.visible ? <div
        className="mbm-hint"
        data-overlay={overlay.dim ? "1" : "0"}
        data-floating={overlay.floating ? "1" : "0"}
      >
        <span>{overlay.text}</span>
      </div> : null}
    </div>;
  }
  return StreamView;
}
