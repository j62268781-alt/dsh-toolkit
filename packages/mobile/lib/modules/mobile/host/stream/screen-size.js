import { createOperation } from "../../../../host/operation.js";
import { Singleflight } from "../../../../host/singleflight.js";
import { isSafeCliFallbackError } from "../device/daemon-rpc.js";

/** One deadline covers both transports; timing out closes actual IO before returning no scale hint. */
export function createScreenSizeLookup({ client, rpc, signal, ttlMs = 60_000, timeoutMs = 2_500 }) {
  const cache = new Map();
  const inflight = new Singleflight();
  const screenSize = (screen) => Number.isFinite(screen?.width) && Number.isFinite(screen?.height)
    ? { width: screen.width, height: screen.height } : null;

  return async function queryScreenSize(deviceId) {
    const cached = cache.get(deviceId);
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    return inflight.run(deviceId, async () => {
      const operation = createOperation({ timeoutMs, signal });
      try {
        operation.throwIfAborted();
        if (rpc !== null && rpc.available !== false) {
          try {
            const result = await rpc.call("device.info", { deviceId }, { signal: operation.signal });
            operation.throwIfAborted();
            const size = screenSize(result?.device?.screenSize);
            if (size !== null) return size;
          } catch (error) {
            if (operation.signal.aborted || !isSafeCliFallbackError(error)) return null;
          }
        }
        operation.throwIfAborted();
        const info = await client.runJson(["device", "info", "--device", deviceId], { signal: operation.signal });
        operation.throwIfAborted();
        return screenSize(info?.device?.screenSize ?? info?.screenSize);
      } catch {
        return null;
      } finally {
        operation.dispose();
      }
    }, {
      onValue: (value) => { if (value !== null) cache.set(deviceId, { at: Date.now(), value }); },
    });
  };
}
