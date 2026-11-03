import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { apply, default as definition, inject, name } from "../../src/modules/usage/host/index.js";
import { USAGE_SNAPSHOT_PATH } from "../../src/modules/usage/host/paths.js";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    end(body = "") { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

async function request(route) {
  const res = createResponse();
  await route.handler({ method: "GET", headers: {} }, res);
  return res;
}

test("module entry exposes the contract name, services and Config", () => {
  assert.equal(name, "toolkit-usage");
  assert.deepEqual(inject, ["sessions", "webServer", "connection"]);
  assert.equal(definition.name, name);
  assert.deepEqual(definition.inject, inject);
  assert.equal(typeof definition.Config, "function");
  assert.equal(typeof definition.apply, "function");
});

test("apply wires the CPU sampler effect, the route and a per-request config read", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "dsh-usage-index-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  await mkdir(join(home, "sessions"), { recursive: true });

  const routes = new Map();
  const cleanups = [];
  let budget = 100;
  const sessions = { list: () => [] };
  const ctx = {
    sessions,
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    connection: { requestRejection: () => undefined },
    logger: { warn() {} },
    effect(fn) {
      const dispose = fn();
      cleanups.push(dispose);
      return dispose;
    },
  };
  const config = {
    budget: { get: () => budget },
    currency: { get: () => "CNY" },
    period: { get: () => "month" },
    historyDays: { get: () => 7 },
    refreshMs: { get: () => 8_000 },
    includeSubagents: { get: () => true },
    prices: { get: () => [] },
  };

  t.after(async () => {
    // Unload the module effects, then restore the process environment.
    for (const dispose of cleanups.reverse()) await dispose?.();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  assert.equal(apply(ctx, config), undefined);
  assert.equal(cleanups.length, 3, "sampler, scan-cache and route effects must all be owned");
  assert.equal(routes.size, 1);
  const route = routes.get(USAGE_SNAPSHOT_PATH);
  assert.ok(route);

  const first = await request(route);
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["cache-control"], "no-store");
  const payload = first.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.sessionCount, 0);
  assert.equal(payload.scan.home, home);
  assert.equal(payload.budget.amount, 100);
  assert.equal(payload.timeline.days, 7);
  assert.equal(payload.refreshMs, 8_000);
  assert.ok(Array.isArray(payload.cpu.history), "the CPU sampler must already have a baseline");
  assert.equal(payload.cpu.warmingUp, true);

  // Volatile settings are re-read for every poll.
  budget = 250;
  const second = await request(route);
  assert.equal(second.json().budget.amount, 250);

  // A broken sessions service must not fail the snapshot.
  sessions.list = () => { throw new Error("sessions unavailable"); };
  const third = await request(route);
  assert.equal(third.statusCode, 200);
  assert.equal(third.json().ok, true);

  // Disposal removes the route and stops the sampler.
  for (const dispose of cleanups.reverse()) await dispose?.();
  assert.equal(routes.size, 0);
});
