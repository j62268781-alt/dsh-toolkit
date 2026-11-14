import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import * as mobile from "../../src/modules/mobile/host/index.ts";
import { AdbProbe } from "../../src/modules/mobile/host/device/android-toolchain.ts";
import {
  StreamAccessController,
  checkTransportFence,
  isLoopbackRemoteAddress,
  isSameOriginRequest,
  parseTrustedAuthority,
} from "../../src/modules/mobile/host/stream/access.ts";
import { StreamRoutes, mountRoutes } from "../../src/modules/mobile/host/stream/routes.ts";

export const TEST_SESSION_COOKIE = "dsh-mobile-test=authenticated";
const PREFIX = "/_dsh/dsh-toolkit-mobile";
const key = Buffer.alloc(32, 42);
const devices = ["A", "B"].map((id) => ({ id, state: "online", platform: "android", type: "device" }));

function requestResponse(method, path, body = {}, headers = {}) {
  const req = Readable.from(method === "POST" ? [Buffer.from(JSON.stringify(body))] : []);
  req.method = method;
  req.url = `${PREFIX}/${path}`;
  req.headers = {
    host: "127.0.0.1:19387",
    origin: "http://127.0.0.1:19387",
    cookie: TEST_SESSION_COOKIE,
    ...headers,
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = {
    statusCode: 0, body: "", headersSent: false, writableEnded: false,
    writeHead(status) { this.statusCode = status; this.headersSent = true; },
    end(body) { this.body = body ?? ""; this.writableEnded = true; },
  };
  return { req, res };
}

function routeHarness(options = {}) {
  const acquired = [];
  const stopped = [];
  const access = new StreamAccessController({ key });
  const routes = new StreamRoutes({
    client: { listDevices: async () => devices, runJson: async () => ({}) },
    pool: { acquire: (id) => { acquired.push(id); return {}; }, stop: (id) => stopped.push(id) },
    access,
    ...options,
  });
  const call = async (path, body = {}, method = "POST") => {
    const { req, res } = requestResponse(method, path, body);
    await routes.handle(path.split(/[/?]/)[0], req, res);
    let json;
    try { json = JSON.parse(res.body); } catch { /* Streaming failures are plain text. */ }
    return { ...res, json };
  };
  return { routes, access, call, acquired, stopped };
}

/** Exercise the actual Cordis effect and host guard, including the authorized HTTP fixtures. */
export async function mountMobileTestRoute(routes, prefix = PREFIX, guard = (req) =>
  req.headers.cookie === TEST_SESSION_COOKIE ? undefined : 401) {
  let mounted;
  let cleanups = 0;
  let dispose;
  const ctx = new Context();
  ctx.provide("webServer", { register(route) { mounted = route; return () => { cleanups += 1; }; } });
  ctx.provide("connection", { requestRejection: guard });
  const fiber = ctx.plugin((child) => { dispose = mountRoutes(child, routes, prefix); });
  await fiber;
  return {
    mounted,
    cleanupCount: () => cleanups,
    dispose: async () => { await dispose(); await fiber.dispose(); },
  };
}

export async function runMobileAuthTests(test) {
  await test("strict loopback accepts IP literals, including expanded and mapped IPv6", () => {
    for (const address of [
      "127.0.0.1", "127.255.255.255", "::1", "0:0:0:0:0:0:0:1",
      "::ffff:127.0.0.1", "::FFFF:7f00:1", "0:0:0:0:0:ffff:7fff:ffff",
    ]) assert.equal(isLoopbackRemoteAddress(address), true, address);
    for (const address of [
      "127.evil.com", "127.0.0.1.evil.com", "127.999.1.1", "127.1", "0177.0.0.1",
      "2130706433", "::2", "::ffff:10.0.0.1", "[::1]", "::1%lo0", "", undefined,
    ]) assert.equal(isLoopbackRemoteAddress(address), false, String(address));
  });

  await test("strict authorities normalize bracketed IPv6 and pin valid ports", () => {
    assert.deepEqual(parseTrustedAuthority("HTTPS://DSH.Example.com:443"), {
      host: "dsh.example.com", port: 443, scheme: "https",
    });
    assert.deepEqual(parseTrustedAuthority("[0:0:0:0:0:0:0:1]:8443"), {
      host: "[::1]", port: 8443, scheme: null,
    });
    assert.deepEqual(parseTrustedAuthority("https://[2001:db8::1]"), {
      host: "[2001:db8::1]", port: null, scheme: "https",
    });
    const trusted = [parseTrustedAuthority("https://[2001:db8::1]:8443")];
    const req = { socket: { remoteAddress: "::1" }, headers: { host: "[2001:0db8::1]:8443", origin: "https://[2001:db8::1]:8443" } };
    assert.equal(checkTransportFence(req, trusted).ok, true);
    req.headers.host = "[2001:db8::1]:8444";
    assert.equal(checkTransportFence(req, trusted).ok, false);
    req.headers.host = "[2001:db8::1]:8443";
    req.headers.origin = "http://[2001:db8::1]:8443";
    assert.equal(checkTransportFence(req, trusted).ok, false);
  });

  await test("malformed IP, bracket, userinfo and port authorities fail closed", () => {
    for (const authority of [
      "127.999.1.1", "127.1", "0177.0.0.1", "2130706433", "::1", "[::1", "[::1]junk",
      "[127.0.0.1]", "[[::1]]", "[::1%lo0]", "[::1]:", "[::1]:80suffix", "[::1]:65536",
      "localhost:", "localhost:0", "localhost:+80", "localhost:-1", "localhost:65536", "localhost:1e2",
      "localhost:80suffix", "localhost:80:90", "localhost:1.5", "user@localhost", "localhost/path",
      "localhost?x=1", "localhost#fragment", "localhost\\evil", "local host", "-localhost", "localhost..",
    ]) {
      assert.equal(parseTrustedAuthority(authority), null, authority);
      assert.equal(checkTransportFence({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: authority } }).ok, false, authority);
    }
    for (const host of [" localhost", "localhost ", "localhost\t", "127.0.0.1\n"]) {
      assert.equal(checkTransportFence({ socket: { remoteAddress: "127.0.0.1" }, headers: { host } }).ok, false, host);
    }
  });

  await test("DNS names starting with 127. require explicit trust", () => {
    for (const host of ["127.evil.com", "127.0.0.1.evil.com", "127.0.0.1.evil.com:3080"]) {
      const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { host } };
      assert.equal(checkTransportFence(req).ok, false, host);
      const trusted = [parseTrustedAuthority(host)];
      assert.equal(checkTransportFence(req, trusted).ok, true, "explicit host configuration still works");
      req.socket.remoteAddress = "10.0.0.1";
      assert.equal(checkTransportFence(req, trusted).ok, false, "trust cannot authorize a remote peer");
    }
    for (const host of ["127.0.0.53:1", "localhost:65535", "[0:0:0:0:0:0:0:1]:3080", "[::ffff:127.0.0.1]:3080"]) {
      assert.equal(checkTransportFence({ socket: { remoteAddress: "::1" }, headers: { host } }).ok, true, host);
    }
  });

  await test("Origin validation supports default ports and canonical IPv6, but rejects non-origins", () => {
    for (const [host, origin] of [["localhost:80", "http://localhost"], ["localhost", "https://localhost:443"], ["[::1]:8080", "http://[0:0:0:0:0:0:0:1]:8080"]]) {
      assert.equal(isSameOriginRequest({ headers: { host, origin } }), true, origin);
    }
    for (const origin of ["", "null", "http://user@localhost:8080", "http://localhost:8080/path", "http://localhost:8080?x=1", "http://localhost:8080junk", "ftp://localhost:8080", "http://evil.com:8080"]) {
      assert.equal(isSameOriginRequest({ headers: { host: "localhost:8080", origin } }), false, origin);
    }
  });

  await test("capability revoke invalidates every old token and reloaded controllers cannot revive it", () => {
    const access = new StreamAccessController({ key });
    const oldA = access.mint("A.with.dots");
    assert.equal(access.verify(oldA).deviceId, "A.with.dots");
    access.revoke();
    assert.deepEqual(access.verify(oldA), { ok: false, reason: "token revoked" });
    const freshA = access.mint("A.with.dots");
    assert.equal(access.verify(freshA).ok, true);
    assert.equal(new StreamAccessController({ key }).verify(freshA).ok, false);
  });

  await test("grant and switch-device revoke A → B → A capabilities before any stream acquire", async () => {
    const h = routeHarness();
    const a = await h.call("grant", { deviceId: "A" });
    assert.equal(a.statusCode, 200);
    assert.equal(h.access.verify(a.json.streamToken).ok, true);
    const aAgain = await h.call("grant", { deviceId: "A" });
    assert.equal(aAgain.statusCode, 200);
    assert.equal(h.access.verify(a.json.streamToken).ok, true, "same-device re-grant must preserve reconnects");
    const b = await h.call("switch-device", { deviceId: "B" });
    assert.equal(b.statusCode, 200);
    assert.equal(h.access.verify(a.json.streamToken).ok, false);
    const backA = await h.call("grant", { deviceId: "A" });
    assert.equal(backA.statusCode, 200);
    assert.equal(h.access.verify(backA.json.streamToken).ok, true);
    const acquiredBefore = h.acquired.length;
    for (const token of [a.json.streamToken, aAgain.json.streamToken, b.json.streamToken]) {
      const response = await h.call(`stream/${token}`, {}, "GET");
      assert.equal(response.statusCode, 401);
    }
    assert.equal(h.acquired.length, acquiredBefore, "revoked tokens must never acquire a session");
    assert.deepEqual(h.stopped, ["A", "B"]);
  });

  await test("a fresh signed token for an inactive device cannot create a stream", async () => {
    const h = routeHarness();
    await h.call("switch-device", { deviceId: "B" });
    const response = await h.call(`stream/${h.access.mint("A")}`, {}, "GET");
    assert.equal(response.statusCode, 409);
    assert.deepEqual(h.acquired, []);
  });

  for (const phase of ["device list", "stream plan"]) {
    await test(`a delayed ${phase} cannot reverse A → B → A selection or mint a new capability`, async () => {
      let release;
      let entered;
      const started = new Promise((resolve) => { entered = resolve; });
      const pending = new Promise((resolve) => { release = resolve; });
      const h = routeHarness(phase === "device list" ? {
        client: { async listDevices() { entered(); return pending; } },
      } : {
        async resolveStreamPlan() { entered(); await pending; return { scale: 1 }; },
      });
      const slow = h.call("grant", { deviceId: "A" });
      await started;
      const b = await h.call("switch-device", { deviceId: "B" });
      const a = await h.call("switch-device", { deviceId: "A" });
      assert.equal(b.statusCode, 200);
      assert.equal(a.statusCode, 200);
      release(phase === "device list" ? devices : undefined);
      const response = await slow;
      assert.equal(response.statusCode, 409);
      assert.equal(response.json.streamToken, undefined);
      assert.equal(h.routes.activeDeviceId, "A");
      assert.deepEqual(h.acquired, [], "stale grant cannot restart an encoder");
      assert.equal(h.access.verify(a.json.streamToken).ok, true, "stale grant cannot revoke the newest selection");
    });
  }

  await test("mounting without WebServer is headless, and missing identity guard is an explicit error", () => {
    assert.equal(mountRoutes({}, {}, PREFIX), null);
    let registrations = 0;
    const ctx = new Context();
    ctx.provide("webServer", { register() { registrations += 1; } });
    assert.throws(() => mountRoutes(ctx, {}, PREFIX), /requires connection\.requestRejection/);
    assert.equal(registrations, 0);
  });

  await test("host auth denial stops every Mobile business handler, including token streams", async () => {
    let business = 0;
    let rejection = 401;
    const mounted = await mountMobileTestRoute({ handle() { business += 1; return true; } }, PREFIX, () => rejection);
    try {
      for (const status of [401, 403]) {
        rejection = status;
        for (const [path, method] of [["grant", "POST"], ["control", "POST"], ["status", "GET"], ["panel-open", "GET"], ["stream/valid-capability", "GET"]]) {
          const { req, res } = requestResponse(method, path);
          await mounted.mounted.handler(req, res);
          assert.equal(res.statusCode, status);
          assert.equal(res.writableEnded, true);
        }
      }
      assert.equal(business, 0);
      rejection = undefined;
      const { req, res } = requestResponse("GET", "status");
      await mounted.mounted.handler(req, res);
      assert.equal(business, 1);
    } finally {
      await mounted.dispose();
      await mounted.dispose();
    }
    assert.equal(mounted.cleanupCount(), 1);
  });

  await test("authenticated requests still need the Mobile loopback fence and POST Origin", async () => {
    let deviceQueries = 0;
    const routes = new StreamRoutes({
      client: { async listDevices() { deviceQueries += 1; return devices; } },
      pool: { sessions: new Map() },
      access: new StreamAccessController({ key }),
    });
    const mounted = await mountMobileTestRoute(routes);
    try {
      const noSession = requestResponse("GET", "status", {}, { cookie: "" });
      await mounted.mounted.handler(noSession.req, noSession.res);
      assert.equal(noSession.res.statusCode, 401);
      const foreignHost = requestResponse("GET", "status", {}, { host: "127.attacker.example" });
      await mounted.mounted.handler(foreignHost.req, foreignHost.res);
      assert.equal(foreignHost.res.statusCode, 403);
      const foreignOrigin = requestResponse("POST", "devices", {}, { origin: "http://attacker.example" });
      await mounted.mounted.handler(foreignOrigin.req, foreignOrigin.res);
      assert.equal(foreignOrigin.res.statusCode, 403);
      assert.equal(deviceQueries, 0);
      const authorized = requestResponse("GET", "status");
      await mounted.mounted.handler(authorized.req, authorized.res);
      assert.equal(authorized.res.statusCode, 200);
      assert.equal(deviceQueries, 1);
    } finally { await mounted.dispose(); }
  });

  await test("optional WebServer and connection injection preserves tools until HTTP dependencies arrive", async () => {
    const parent = realpathSync(import.meta.dirname);
    const home = mkdtempSync(join(parent, ".tmp-auth-"));
    const previousHome = process.env.DSH_HOME;
    const previousProbe = AdbProbe.prototype.get;
    const names = new Set();
    let mounted;
    let unregistered = 0;
    let fiber;
    const ctx = new Context();
    ctx.provide("tools", { register(tool) { names.add(tool.name); return () => names.delete(tool.name); } });
    const settle = async () => {
      for (const runtime of ctx.registry.values()) for (const child of runtime.fibers) await child.await();
    };
    try {
      process.env.DSH_HOME = home;
      AdbProbe.prototype.get = async () => ({ reason: "ok", available: true, path: "test-adb", usable: 0 });
      fiber = ctx.plugin(mobile, { binaryPath: process.execPath, useDaemonRpc: false, registerSkills: false });
      await fiber;
      await settle();
      assert.equal(names.size, Object.keys(mobile.TOOL_NAMES).length);
      ctx.provide("webServer", { register(route) { mounted = route; return () => { unregistered += 1; }; } });
      await settle();
      assert.equal(mounted, undefined, "WebServer without connection must not expose routes");
      assert.equal(names.size, Object.keys(mobile.TOOL_NAMES).length);
      ctx.provide("connection", { requestRejection: () => 401 });
      await settle();
      assert.equal(mounted?.kind, "prefix");
      const { req, res } = requestResponse("GET", "status");
      await mounted.handler(req, res);
      assert.equal(res.statusCode, 401);
      await fiber.dispose();
      assert.equal(unregistered, 1);
      assert.equal(names.size, 0);
    } finally {
      await fiber?.dispose();
      AdbProbe.prototype.get = previousProbe;
      if (previousHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousHome;
      const actual = realpathSync(home);
      assert.equal(dirname(actual), parent);
      assert.equal(actual.startsWith(join(parent, ".tmp-auth-")), true);
      rmSync(actual, { recursive: true });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let passed = 0;
  let failed = 0;
  await runMobileAuthTests(async (name, run) => {
    try { await run(); passed += 1; console.log(`PASS ${name}`); }
    catch (error) { failed += 1; console.error(`FAIL ${name}\n${error.stack}`); }
  });
  console.log(`Mobile auth: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
