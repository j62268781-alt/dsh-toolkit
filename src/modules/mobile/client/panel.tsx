import { startPolling } from "../../../client/poll.js";
import { deviceKindLabel } from "./presentation.js";
import { CHASSIS_INSET } from "./stream/canvas.js";
import { REGRANT_MIN_INTERVAL_MS, REGRANT_TICK_MS, newRegrantStreak, neededPixelWidth, nextCooldownAfterGrant, tickRegrant } from "./stream/adaptive.js";
export function createMobilePanel(React, { primitives, api, CSS, canvasRuntime, StreamView, icons, renderDeviceOptions }) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useCallback, useMemo } = React;
  const { Button, Tooltip, IconChevronDownOutlineRegular } = primitives;
  const { IconHome, IconBack, IconRotate, IconRefresh, IconFrame, IconFrameNone } = icons;
  const { measureStage, maxMediaCssWidth, getPanelCssWidth, setDevicePixelWidth } = canvasRuntime;
  function nextFrame() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 16);
    });
  }
  function MobilePanel() {
    const [devices, setDevices] = useState([]);
    const devicesRef = useRef([]);
    const rememberDevices = useCallback((list) => {
      devicesRef.current = Array.isArray(list) ? list : [];
      setDevices(devicesRef.current);
    }, []);
    const [activeId, setActiveId] = useState(null);
    const [token, setToken] = useState(null);
    const [format, setFormat] = useState("unknown");
    const [frame, setFrame] = useState("device");
    const [busy, setBusy] = useState(false);
    const rootRef = useRef(null);
    const [booting, setBooting] = useState(false);
    const [error, setError] = useState(null);
    const [streaming, setStreaming] = useState(false);
    const [adb, setAdb] = useState(null);
    // 列表尚未查到时状态未知，不能把面板首次打开误报为设备掉线。
    const [statusSeen, setStatusSeen] = useState(false);
    const frameSizeRef = useRef({ width: 0, height: 0 });
    const deviceWidthRef = useRef(0);
    const lastRegrantAtRef = useRef(0);
    const regrantCooldownRef = useRef(REGRANT_MIN_INTERVAL_MS);
    const regrantStreakRef = useRef(newRegrantStreak());
    const busyRef = useRef(false);
    const fixedScaleRef = useRef(false);
    const lastNeedPxRef = useRef(0);
    const preferredStreamWidth = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const panelCssWidth = getPanelCssWidth();
      if (panelCssWidth > 0) {
        return neededPixelWidth(panelCssWidth, dpr, deviceWidthRef.current);
      }
      const stage = rootRef.current === null ? null : rootRef.current.querySelector(".mbm-stage");
      if (stage === null) return 0;
      const staged = stage.getAttribute("data-frame") === "device" ? CHASSIS_INSET * 2 : 0;
      const availWidth = Math.min(
        measureStage(stage).availWidth - staged,
        maxMediaCssWidth(dpr)
      );
      if (!(availWidth > 0)) return 0;
      return neededPixelWidth(availWidth, dpr, deviceWidthRef.current);
    };
    // 稳定回调配合同步 refs，设备列表或 busy 变化不应触发重新取流。
    const grant = useCallback(
      async (deviceId, options) => {
        setBusy(true);
        busyRef.current = true;
        setError(null);
        lastRegrantAtRef.current = options?.regrant === true ? performance.now() : 0;
        regrantStreakRef.current = newRegrantStreak();
        try {
          const target = devicesRef.current.find((d) => d.id === deviceId);
          const willBoot = target !== void 0 && target.state !== "online" && (target.type === "simulator" || target.type === "emulator");
          if (willBoot) setBooting(true);
          const body = deviceId === void 0 ? {} : { deviceId };
          const preferredWidth = preferredStreamWidth();
          if (preferredWidth > 0) body.preferredWidth = preferredWidth;
          const result = await api("grant", body);
          rememberDevices(result.devices ?? []);
          setActiveId(result.device?.id ?? null);
          setToken(result.streamToken ?? null);
          fixedScaleRef.current = result.fixed === true;
          if (typeof result.deviceWidth === "number" && result.deviceWidth > 0) {
            deviceWidthRef.current = result.deviceWidth;
            setDevicePixelWidth(result.deviceWidth);
          }
          const effectiveWidth = typeof result.deviceWidth === "number" && result.deviceWidth > 0 && typeof result.scale === "number" && result.scale > 0 ? Math.round(result.deviceWidth * result.scale) : 0;
          regrantCooldownRef.current = nextCooldownAfterGrant(
            regrantCooldownRef.current,
            preferredWidth,
            effectiveWidth
          );
          if (fixedScaleRef.current) {
            regrantCooldownRef.current = REGRANT_MIN_INTERVAL_MS;
          }
          if (typeof result.bootError === "string" && result.bootError !== "") {
            setError(`设备已选中，但启动失败：${result.bootError}`);
          }
        } catch (err) {
          setError(err?.message ?? String(err));
          setToken(null);
        } finally {
          setBooting(false);
          setBusy(false);
          busyRef.current = false;
        }
      },
      [rememberDevices]
    );
    useEffect(() => {
      let cancelled = false;
      const start = async () => {
        let previous = -1;
        let stable = 0;
        for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
          const current = preferredStreamWidth();
          if (current > 0 && current === previous) {
            stable += 1;
            if (stable >= 2) break;
          } else {
            stable = 0;
          }
          previous = current;
          await nextFrame();
        }
        if (!cancelled) void grant();
      };
      void start();
      return () => {
        cancelled = true;
      };
    }, [grant]);
    useEffect(() => {
      if (activeId === null) return void 0;
      const timer = setInterval(() => {
        if (busyRef.current) return;
        if (offlineRef.current) return;
        const now = performance.now();
        const needPx = preferredStreamWidth();
        const prevPx = lastNeedPxRef.current;
        lastNeedPxRef.current = needPx;
        const framePx = frameSizeRef.current.width;
        if (!tickRegrant({
          fixed: fixedScaleRef.current,
          streak: regrantStreakRef.current,
          prevPx,
          needPx,
          framePx,
          now,
          lastAt: lastRegrantAtRef.current,
          cooldown: regrantCooldownRef.current
        })) {
          return;
        }
        regrantStreakRef.current = newRegrantStreak();
        lastRegrantAtRef.current = now;
        void grant(activeId, { regrant: true });
      }, REGRANT_TICK_MS);
      return () => clearInterval(timer);
    }, [activeId, grant]);
    useEffect(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return void 0;
      }
      let stopped = false;
      let query = null;
      let onChange = null;
      const watch = () => {
        if (stopped) return;
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        onChange = () => {
          regrantStreakRef.current = newRegrantStreak();
          watch();
        };
        if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
        else if (typeof query.addListener === "function") query.addListener(onChange);
      };
      watch();
      return () => {
        stopped = true;
        if (query === null || onChange === null) return;
        if (typeof query.removeEventListener === "function") query.removeEventListener("change", onChange);
        else if (typeof query.removeListener === "function") query.removeListener(onChange);
      };
    }, []);
    useEffect(() => {
      const poll = startPolling(async (signal) => {
        const status = await api("status", undefined, { signal });
        if (signal.aborted) return;
        setStreaming(status.streaming === true);
        setFormat(status.format ?? "unknown");
        if (Array.isArray(status.devices)) rememberDevices(status.devices);
        setAdb(status.adb ?? null);
        setStatusSeen(true);
      }, { intervalMs: 5_000 });
      return () => poll.stop();
    }, []);
    const act = useCallback(
      async (action) => {
        setError(null);
        try {
          await api("device-action", { action });
        } catch (err) {
          setError(err?.message ?? String(err));
        }
      },
      []
    );
    const active = useMemo(
      () => devices.find((d) => d.id === activeId) ?? null,
      [devices, activeId]
    );
    const deviceState = activeId === null ? null : active === null ? statusSeen ? "offline" : null : active.state === "online" ? "online" : "offline";
    const offlineRef = useRef(false);
    offlineRef.current = deviceState === "offline";
    const BarButton = ({ label, icon: Icon, onClick, disabled = false }) => <Tooltip label={label} side="bottom" delayMs={400}>
      <Button
        size="sm"
        variant="ghost"
        className="mbm-tool"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        icon={<Icon size={16} />}
      />
    </Tooltip>;
    const select = <div className="mbm-selectWrap">
      <select
        className="mbm-select"
        value={activeId ?? ""}
        disabled={busy}
        onChange={(e) => void grant(e.target.value)}
        aria-label="选择设备"
      >
        {devices.length === 0 ? <option value="">未发现设备</option> : renderDeviceOptions(devices)}
      </select>
      <IconChevronDownOutlineRegular className="mbm-selectCaret" size={16} />
    </div>;
    const toolbar = <div className="mbm-bar">
      {select}
      <div className="mbm-actions">
        <BarButton
          key="home"
          label="主屏幕"
          icon={IconHome}
          disabled={activeId === null}
          onClick={() => void act("home")}
        />
        {active?.platform === "android" ? <BarButton
          key="back"
          label="返回"
          icon={IconBack}
          disabled={activeId === null}
          onClick={() => void act("back")}
        /> : null}
        <BarButton
          key="rotate"
          label="旋转"
          icon={IconRotate}
          disabled={activeId === null}
          onClick={() => void act("rotate")}
        />
        <BarButton
          key="reconnect"
          label="重新连接"
          icon={IconRefresh}
          disabled={busy}
          onClick={() => void grant(activeId ?? void 0)}
        />
        <BarButton
          key="frame"
          label="切换外观"
          icon={frame === "frameless" ? IconFrameNone : IconFrame}
          onClick={() => setFrame(frame === "bezel" ? "device" : frame === "device" ? "frameless" : "bezel")}
        />
      </div>
    </div>;
    const status = <div className="mbm-status">
      {booting ? <span>
        <i className="mbm-dot" data-on="2" />
        正在启动设备…（首次可能要几分钟）
      </span> : <span>
        <i className="mbm-dot" data-on={streaming ? "1" : "0"} />
        {streaming ? "实时" : "未串流"}
      </span>}
      {active === null ? null : <span>{`${active.platform} · ${deviceKindLabel(active.type)} · ${active.version ?? "?"}`}</span>}
      {format === "unknown" ? null : <span>{format === "h264" ? "H.264" : format === "mjpeg" ? "MJPEG" : format}</span>}
      {error === null ? null : <span className="mbm-err">{error}</span>}
    </div>;
    const adbWarning = devices.length === 0 && adb !== null && adb.reason !== "ok" && adb.message ? <div className="mbm-adb">
      <strong>无法发现 Android 设备</strong>
      <span>{adb.message}</span>
      {adb.hint ? <span className="mbm-adbHint">{adb.hint}</span> : null}
      {adb.path ? <code className="mbm-adbPath">{`adb: ${adb.path}`}</code> : null}
    </div> : null;
    return <div className="mbm-root" ref={rootRef}>
      {/* 宿主管理 React 注入的 style，并在插件卸载时清理。 */}
      <style>{CSS}</style>
      {toolbar}
      {adbWarning}
      <StreamView
        key={activeId ?? "none"}
        deviceId={activeId}
        streamToken={token}
        format={format}
        frame={frame}
        deviceKind={active?.platform ?? null}
        deviceState={deviceState}
        frameSizeRef={frameSizeRef}
        onError={(message) => setError(message)}
      />
      {status}
    </div>;
  }
  return MobilePanel;
}
