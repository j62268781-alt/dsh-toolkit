import assert from "node:assert/strict";
import { test } from "node:test";
import { registerUsageRoute } from "../../src/modules/usage/host/route.js";
import { USAGE_SNAPSHOT_PATH } from "../../src/modules/usage/host/paths.js";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; this.ended = true; },
    json() { return JSON.parse(this.body); },
  };
}

function createContext({ rejection, snapshot } = {}) {
  const routes = new Map();
  const cleanups = [];
  const calls = { snapshots: 0 };
  const ctx = {
    effect(fn) {
      const dispose = fn();
      cleanups.push(dispose);
      return dispose;
    },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    connection: {
      requestRejection(req) {
        assert.equal(this.requestRejection, ctx.connection.requestRejection);
        return typeof rejection === "function" ? rejection(req) : rejection;
      },
    },
  };
  registerUsageRoute(ctx, () => {
    calls.snapshots += 1;
    return typeof snapshot === "function" ? snapshot() : snapshot;
  });
  return { ctx, routes, cleanups, calls, route: routes.get(USAGE_SNAPSHOT_PATH) };
}

function request(route, method = "GET") {
  const res = createResponse();
  const pending = route.handler({ method, headers: {} }, res);
  return { res, pending };
}

test("registers exactly one authenticated GET route at the documented path", () => {
  const { routes, cleanups, route } = createContext();
  assert.deepEqual([...routes.keys()], [USAGE_SNAPSHOT_PATH]);
  assert.equal(route.kind, "exact");
  assert.equal(route.path, "/_dsh/dsh-toolkit/usage/snapshot");
  assert.equal(cleanups.length, 1);
});

test("GET returns 200 JSON with no-store and never caches across polls", async () => {
  const { route, calls } = createContext({ snapshot: { ok: true, sessionCount: 1 } });
  const first = request(route);
  await first.pending;
  assert.equal(first.res.statusCode, 200);
  assert.equal(first.res.headers["cache-control"], "no-store");
  assert.equal(first.res.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(first.res.json(), { ok: true, sessionCount: 1 });

  const second = request(route);
  await second.pending;
  assert.equal(second.res.statusCode, 200);
  assert.equal(calls.snapshots, 2, "each poll must refresh the snapshot");
});

test("non-GET methods answer 404 without producing a snapshot", async () => {
  const { route, calls } = createContext({ snapshot: { ok: true } });
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    const { res, pending } = request(route, method);
    await pending;
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.json(), { ok: false, reason: "not-found" });
  }
  assert.equal(calls.snapshots, 0);
});

test("the host identity guard rejects before the snapshot is produced", async () => {
  const { route, calls } = createContext({ rejection: 401, snapshot: { ok: true } });
  const { res, pending } = request(route);
  await pending;
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, undefined);
  assert.equal(calls.snapshots, 0);
});

test("synchronous and asynchronous snapshot failures become 500 JSON receipts", async () => {
  const sync = createContext({ snapshot: () => { throw new Error("sync boom"); } });
  const syncResult = request(sync.route);
  await syncResult.pending;
  assert.equal(syncResult.res.statusCode, 500);
  assert.deepEqual(syncResult.res.json(), { ok: false, error: "sync boom" });

  const async = createContext({ snapshot: async () => { throw new Error("async boom"); } });
  const asyncResult = request(async.route);
  await asyncResult.pending;
  assert.equal(asyncResult.res.statusCode, 500);
  assert.deepEqual(asyncResult.res.json(), { ok: false, error: "async boom" });
});

test("a null snapshot is serialized without throwing", async () => {
  const { route } = createContext({ snapshot: null });
  const { res, pending } = request(route);
  await pending;
  assert.equal(res.statusCode, 200);
  assert.equal(res.json(), null);
});
