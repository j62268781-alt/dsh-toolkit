import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Singleflight } from "../../src/host/singleflight.js";
import { Mobilecli, MobilecliError } from "../../src/modules/mobile/host/device/mobilecli.js";
import { AdbProbe } from "../../src/modules/mobile/host/device/android-toolchain.js";
import { callDaemon, DaemonRpc, isSafeCliFallbackError } from "../../src/modules/mobile/host/device/daemon-rpc.js";
import { createScreenSizeLookup } from "../../src/modules/mobile/host/stream/screen-size.js";
import { createMobileLoopTool } from "../../src/modules/mobile/host/agent/tools.js";
import { createUseH264Canvas } from "../../src/modules/mobile/client/stream/use-h264-canvas.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };
async function until(check) {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("fixture did not become ready");
    await delay(5);
  }
}
function globals(values) {
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}
function clock() {
  let next = 0;
  const timeouts = new Map(), intervals = new Map(), frames = new Map();
  return {
    timeouts, intervals, frames,
    values: {
      setTimeout(fn, ms) { const id = ++next; timeouts.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timeouts.delete(id); },
      setInterval(fn, ms) { const id = ++next; intervals.set(id, { fn, ms }); return id; },
      clearInterval(id) { intervals.delete(id); },
      requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
    fireTimeout() {
      const entry = timeouts.entries().next().value;
      assert.ok(entry, "expected a scheduled timeout");
      timeouts.delete(entry[0]); entry[1].fn();
    },
  };
}
function temporaryDirectory(parent, prefix) {
  const root = realpathSync(parent);
  const directory = mkdtempSync(join(root, prefix));
  return {
    directory,
    remove() {
      const actual = realpathSync(directory);
      assert.equal(dirname(actual), root);
      assert.ok(actual.startsWith(join(root, prefix)));
      rmSync(actual, { recursive: true, force: true });
    },
  };
}
async function socketServer(handler) {
  const temporary = temporaryDirectory(process.platform === "darwin" ? "/tmp" : tmpdir(), "dsh-mob-cache-");
  const socketPath = join(temporary.directory, "daemon.sock");
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  return {
    socketPath, home: temporary.directory,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      temporary.remove();
    },
  };
}
function deviceClient() {
  const calls = [];
  const client = new Mobilecli({ binary: process.execPath });
  client.runJson = (args, options) => {
    const work = deferred(); calls.push({ ...work, args, options }); return work.promise;
  };
  return { client, calls };
}
function mountH264(fetch, Decoder = class {}) {
  const timers = clock();
  let cleanup, unwatched = 0;
  const states = [];
  const restore = globals({ ...timers.values, fetch, VideoDecoder: Decoder, EncodedVideoChunk: class { constructor(value) { Object.assign(this, value); } } });
  const hook = createUseH264Canvas({ useEffect(fn) { cleanup = fn(); } }, {
    watchStageSize: () => () => { unwatched += 1; },
    fitCanvasToFrame: () => ({ downscale: 1 }), getMediaContext: () => null,
  });
  hook("/stream", { current: {} }, (...state) => states.push(state), { current: null });
  return { timers, states, stop: () => cleanup(), unwatched: () => unwatched, restore };
}

export async function runMobileCacheTests(test) {
  await test("singleflight shares current work and detaches invalidated success/finally", async () => {
    const flights = new Singleflight(), old = deferred(), current = deferred();
    const values = [];
    const first = flights.run("device", () => old.promise, { onValue: (value) => values.push(value) });
    assert.equal(flights.run("device", () => { throw new Error("duplicate work"); }), first);
    flights.invalidate("device");
    const second = flights.run("device", () => current.promise, { onValue: (value) => values.push(value) });
    old.resolve("old"); assert.equal(await first, "old");
    assert.deepEqual(values, []);
    assert.equal(flights.run("device", () => "unexpected"), second, "old finally must not remove the new flight");
    current.resolve("new"); assert.equal(await second, "new");
    assert.deepEqual(values, ["new"]);
  });

  await test("singleflight clear suppresses late errors without deleting a newer flight", async () => {
    const flights = new Singleflight(), old = deferred(), current = deferred();
    let errors = 0;
    const first = flights.run("device", () => old.promise, { onError: () => { errors += 1; } });
    const rejected = assert.rejects(first, /old failure/);
    flights.clear();
    const second = flights.run("device", () => current.promise);
    old.reject(new Error("old failure")); await rejected;
    assert.equal(errors, 0);
    assert.equal(flights.has("device"), true);
    current.resolve("new"); assert.equal(await second, "new");
  });

  await test("Mobile device invalidation prevents old success/finally from replacing new work", async () => {
    const { client, calls } = deviceClient();
    const first = client.listDevices(); await flush();
    const joined = client.listDevices({ fresh: true }); await flush();
    assert.equal(calls.length, 1, "fresh preserves the existing in-flight joining policy");
    client.invalidateDevices();
    const second = client.listDevices(); await flush();
    assert.equal(calls.length, 2);
    calls[0].resolve({ devices: [{ id: "old" }] }); await Promise.all([first, joined]);
    const third = client.listDevices(); await flush();
    assert.equal(calls.length, 2, "old completion must not clear the current in-flight lookup");
    calls[1].resolve({ devices: [{ id: "new" }] }); await Promise.all([second, third]);
    assert.deepEqual(await client.listDevices(), [{ id: "new" }]);
  });

  await test("Mobile late lookup failure cannot erase a newer device cache", async () => {
    const { client, calls } = deviceClient();
    const old = client.listDevices({ includeOffline: true }); await flush();
    const rejected = assert.rejects(old, /old discovery/);
    client.invalidateDevices();
    const current = client.listDevices({ includeOffline: true }); await flush();
    calls[1].resolve({ devices: [{ id: "new" }] }); await current;
    calls[0].reject(new Error("old discovery")); await rejected;
    assert.deepEqual(await client.listDevices({ includeOffline: true }), [{ id: "new" }]);
    assert.equal(calls.length, 2);
  });

  await test("Mobile keeps online/offline discovery keys separate and cached signal reads cheap", async () => {
    const { client, calls } = deviceClient();
    const online = client.listDevices(), all = client.listDevices({ includeOffline: true }); await flush();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.args), [["devices"], ["devices", "--include-offline"]]);
    calls[0].resolve({ devices: [{ id: "online" }] }); calls[1].resolve({ devices: [{ id: "all" }] });
    await Promise.all([online, all]);
    assert.deepEqual(await client.listDevices({ signal: new AbortController().signal }), [{ id: "online" }]);
    assert.equal(calls.length, 2);
  });

  await test("ADB deduplicates ordinary queries but forced probes each start a new generation", async () => {
    const work = [];
    const probe = new AdbProbe({ probe: () => { const pending = deferred(); work.push(pending); return pending.promise; } });
    const first = probe.get(), joined = probe.get(); await flush(); assert.equal(work.length, 1);
    const forced = probe.get({ fresh: true }), forcedAgain = probe.get({ fresh: true }); await flush();
    assert.equal(work.length, 3, "each fresh probe preserves its force policy");
    work[2].resolve({ reason: "ok", marker: "latest" }); await forcedAgain;
    work[0].resolve({ reason: "ok", marker: "old" }); await Promise.all([first, joined]);
    work[1].resolve({ reason: "ok", marker: "middle" }); await forced;
    assert.equal((await probe.get()).marker, "latest");
    probe.invalidate(); const after = probe.get(); await flush(); assert.equal(work.length, 4);
    work[3].resolve({ reason: "ok", marker: "after" }); await after;
  });

  await test("Mobile runJson cancellation waits for child exit and preserves the caller reason", async () => {
    const temporary = temporaryDirectory(new URL("./", import.meta.url), ".tmp-cache-");
    const pidFile = join(temporary.directory, "pid");
    const controller = new AbortController(), reason = new DOMException("cancel command", "AbortError");
    const client = new Mobilecli({ binary: process.execPath });
    const code = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const pending = client.runJson(["-e", code], { signal: controller.signal });
    const rejected = assert.rejects(pending, (error) => error === reason);
    try {
      await until(() => existsSync(pidFile));
      const pid = Number(readFileSync(pidFile, "utf8"));
      controller.abort(reason); await rejected;
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      const cancelled = new AbortController(); cancelled.abort(reason);
      await assert.rejects(client.runJson(["-e", code], { signal: cancelled.signal }), (error) => error === reason);
      await assert.rejects(client.runJson(["-e", "process.stdout.write(JSON.stringify({status:'error',error:'business failure'})); process.exitCode = 2;"]),
        (error) => error instanceof MobilecliError && error.code === "MOBILECLI_REPORTED" && error.message === "business failure");
    } finally { controller.abort(); await rejected; temporary.remove(); }
  });

  if (process.platform !== "win32") {
    await test("daemon cancellation closes its socket; dispose also aborts active requests", async () => {
      const received = deferred(), closed = deferred();
      const server = await socketServer((socket) => { socket.once("data", () => received.resolve()); socket.once("close", () => closed.resolve()); });
      const controller = new AbortController(), reason = new DOMException("stop RPC", "AbortError");
      try {
        const pending = callDaemon("device.io.tap", {}, { socketPath: server.socketPath, signal: controller.signal });
        const rejected = assert.rejects(pending, (error) => error === reason && !isSafeCliFallbackError(error));
        await received.promise; controller.abort(reason); await rejected; await closed.promise;
        const rpc = new DaemonRpc({ home: server.home });
        const active = rpc.call("device.info", {});
        const disposed = assert.rejects(active, { name: "AbortError" });
        await flush(); rpc.dispose(); await disposed;
        rpc.reset(); assert.equal(rpc.available, false);
        await assert.rejects(rpc.call("device.info", {}), { name: "AbortError" });
      } finally { controller.abort(); await server.close(); }
    });

    await test("screen-size 2500ms budget closes real stalled RPC without a CLI replay", async () => {
      let requests = 0, cli = 0;
      const closed = deferred();
      const server = await socketServer((socket) => { socket.on("data", () => { requests += 1; }); socket.once("close", () => closed.resolve()); });
      const rpc = new DaemonRpc({ home: server.home });
      const query = createScreenSizeLookup({ rpc, client: { runJson: async () => { cli += 1; } } });
      const start = Date.now();
      try {
        assert.deepEqual(await Promise.all([query("A"), query("A")]), [null, null]);
        await closed.promise;
        assert.equal(requests, 1); assert.equal(cli, 0);
        assert.ok(Date.now() - start < 4_500, "must not retain the daemon's 15-second request");
      } finally { rpc.dispose(); await server.close(); }
    });
  }

  await test("screen-size falls back only on safe connection failure and caches successful dimensions", async () => {
    let calls = 0;
    const query = createScreenSizeLookup({ rpc: { call: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } },
      client: { runJson: async (_args, { signal }) => { calls += 1; assert.equal(signal.aborted, false); return { screenSize: { width: 1080, height: 2400 } }; } } });
    assert.deepEqual(await query("A"), { width: 1080, height: 2400 }); await query("A"); assert.equal(calls, 1);
    for (const code of ["ECONNRESET", "ETIMEDOUT", "EPIPE"]) {
      const uncertain = createScreenSizeLookup({ rpc: { call: async () => { throw Object.assign(new Error(code), { code }); } },
        client: { runJson: async () => { throw new Error("must not replay uncertain RPC"); } } });
      assert.equal(await uncertain("A"), null);
    }
  });

  await test("screen-size scope cancellation reaches and closes the actual CLI process", async () => {
    const temporary = temporaryDirectory(new URL("./", import.meta.url), ".tmp-cache-");
    const pidFile = join(temporary.directory, "pid"), controller = new AbortController();
    const client = new Mobilecli({ binary: process.execPath });
    const query = createScreenSizeLookup({ rpc: null, signal: controller.signal, client: {
      runJson: (_args, options) => client.runJson(["-e", `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(() => {}, 1000);`], options),
    } });
    try {
      const pending = query("A"); await until(() => existsSync(pidFile));
      const pid = Number(readFileSync(pidFile, "utf8")); controller.abort();
      assert.equal(await pending, null);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally { controller.abort(); temporary.remove(); }
  });

  await test("mobile_loop uses SDK execution signal and ignores a late judgment answer", async () => {
    const controller = new AbortController(), answer = deferred(), asked = deferred(); let taps = 0, reads = 0;
    const fingerprint = () => "same-state";
    const tool = createMobileLoopTool({
      client: { runJson: async (_args, options) => { assert.equal(options.signal, controller.signal); reads += 1;
        return { elements: [{ label: "Open settings", type: "button", rect: { x: 0, y: 0, width: 20, height: 20 } }] }; } },
      getJudge: () => ({ apiVersion: 1, status: () => ({ purposes: [{ purpose: "mobile.action", usable: true }] }), fingerprint,
        ask: (_state, _questions, options) => { assert.equal(options.signal, controller.signal); asked.resolve(); return answer.promise; } }),
      performTap: async () => { taps += 1; },
    });
    const pending = tool.execute({ device: "A", goal: "open settings", max_steps: 1 }, { signal: controller.signal });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await asked.promise; controller.abort();
    answer.resolve({ fingerprint: "same-state", answers: { next_step: { kind: "choice", optionId: "tap_1", probabilities: { tap_1: 1 } } } });
    await rejected; assert.equal(reads, 1); assert.equal(taps, 0);
  });

  await test("H264 cleanup aborts delayed fetch and cancels a late body without acquiring a reader", async () => {
    const response = deferred(); let signal, cancelled = 0, acquired = 0;
    const mounted = mountH264((_url, options) => { signal = options.signal; return response.promise; });
    try {
      mounted.stop(); assert.equal(signal.aborted, true);
      response.resolve({ ok: true, body: { cancel() { cancelled += 1; return Promise.reject(new Error("already closed")); }, getReader() { acquired += 1; } } });
      await flush(); assert.equal(cancelled, 1); assert.equal(acquired, 0);
      assert.deepEqual(mounted.states, [["connecting", undefined]]);
      assert.equal(mounted.unwatched(), 1); assert.equal(mounted.timers.timeouts.size, 0); assert.equal(mounted.timers.intervals.size, 0);
    } finally { mounted.restore(); }
  });

  await test("H264 cleanup releases reader, queued frames, decoder, rAF and watchdog", async () => {
    const reading = deferred(), frames = [], decoders = []; let cancelled = 0, released = 0, firstRead = true;
    const frame = () => { const value = { displayWidth: 100, displayHeight: 200, closes: 0, close() { this.closes += 1; } }; frames.push(value); return value; };
    class Decoder {
      constructor(options) { this.options = options; this.state = "unconfigured"; this.closes = 0; decoders.push(this); }
      configure() { this.state = "configured"; }
      decode() { this.options.output(frame()); this.options.output(frame()); }
      close() { this.closes += 1; this.state = "closed"; }
    }
    const reader = { read() { if (!firstRead) return reading.promise; firstRead = false;
      return Promise.resolve({ done: false, value: new Uint8Array([0,0,1,0x67,0x42,0,0x1f,0,0,1,0x68,0,0,0,1,0x65,0x11,0,0,1,0x61,0x22]) }); },
      cancel() { cancelled += 1; reading.resolve({ done: true }); return Promise.reject(new Error("closed reader")); }, releaseLock() { released += 1; } };
    const mounted = mountH264(async () => ({ ok: true, body: { getReader: () => reader } }), Decoder);
    try {
      await flush(); assert.equal(decoders.length, 1); assert.equal(frames.length, 2); assert.equal(frames[0].closes, 1);
      assert.equal(mounted.timers.frames.size, 1); assert.equal(mounted.timers.intervals.size, 1);
      mounted.stop(); await flush();
      assert.equal(frames[1].closes, 1); assert.equal(decoders[0].closes, 1); assert.ok(cancelled >= 1); assert.equal(released, 1);
      const late = frame(); decoders[0].options.output(late); assert.equal(late.closes, 1);
      assert.equal(mounted.timers.frames.size, 0); assert.equal(mounted.timers.intervals.size, 0); assert.equal(mounted.timers.timeouts.size, 0);
    } finally { mounted.restore(); }
  });

  await test("H264 stalled-read watchdog cancels the real hook and schedules reconnect", async () => {
    const reading = deferred(); let cancelled = 0, released = 0;
    const reader = { read: () => reading.promise, cancel() { cancelled += 1; reading.resolve({ done: true }); return Promise.resolve(); }, releaseLock() { released += 1; } };
    const mounted = mountH264(async () => ({ ok: true, body: { getReader: () => reader } }));
    const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
    const start = performance.now();
    try {
      await flush(); assert.equal(mounted.timers.intervals.size, 1);
      Object.defineProperty(performance, "now", { configurable: true, value: () => start + 4_000 });
      [...mounted.timers.intervals.values()][0].fn(); await flush();
      assert.ok(cancelled >= 1); assert.equal(released, 1);
      assert.equal(mounted.timers.intervals.size, 0); assert.equal(mounted.timers.timeouts.size, 1);
      assert.equal([...mounted.timers.timeouts.values()][0].ms, 1_000);
      assert.ok(mounted.states.some(([state, detail]) => state === "connecting" && detail?.includes("画面卡住")));
      mounted.stop(); await flush(); assert.equal(mounted.timers.timeouts.size, 0);
    } finally {
      if (descriptor) Object.defineProperty(performance, "now", descriptor);
      else delete performance.now;
      mounted.restore();
    }
  });

  await test("H264 cleanup clears reconnect delay and prevents a new fetch", async () => {
    let calls = 0;
    const mounted = mountH264(async () => { calls += 1; throw new Error("network unavailable"); });
    try {
      await flush(); assert.equal(mounted.timers.timeouts.size, 1);
      mounted.stop(); await flush(); assert.equal(mounted.timers.timeouts.size, 0); assert.equal(calls, 1);
    } finally { mounted.restore(); }
  });

  await test("Mobile status waits for completion and aborts late unmounted results", async () => {
    const { build } = await import("esbuild");
    const output = await build({ entryPoints: [fileURLToPath(new URL("../../src/modules/mobile/client/panel.jsx", import.meta.url))],
      bundle: true, write: false, format: "esm", platform: "node", target: "es2022", jsxFactory: "h", jsxFragment: "Fragment", logLevel: "silent" });
    const { createMobilePanel } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
    const effects = [], writes = [], work = [], timers = clock();
    const restore = globals({ ...timers.values, window: {} });
    const React = { createElement: () => ({}), useState: (value) => [value, (next) => writes.push(next)], useRef: (value) => ({ current: value }),
      useEffect: (fn) => effects.push(fn), useCallback: (fn) => fn, useMemo: (fn) => fn() };
    const Panel = createMobilePanel(React, { primitives: {}, CSS: "", icons: {}, StreamView: () => null, renderDeviceOptions: () => [],
      canvasRuntime: {}, api(route, _body, { signal }) { assert.equal(route, "status"); const pending = deferred(); work.push({ ...pending, signal }); return pending.promise; } });
    let cleanup;
    try {
      Panel(); assert.equal(effects.length, 4); cleanup = effects[3](); await flush();
      assert.equal(work.length, 1); assert.equal(timers.timeouts.size, 0, "no interval starts while status is pending");
      work[0].resolve({ devices: [], streaming: true }); await flush();
      assert.equal(timers.timeouts.size, 1); assert.equal([...timers.timeouts.values()][0].ms, 5_000);
      timers.fireTimeout(); await flush(); assert.equal(work.length, 2);
      const before = writes.length; cleanup(); assert.equal(work[1].signal.aborted, true);
      work[1].resolve({ devices: [{ id: "late" }], streaming: false }); await flush();
      assert.equal(writes.length, before); assert.equal(timers.timeouts.size, 0);
    } finally { cleanup?.(); restore(); }
  });
}
