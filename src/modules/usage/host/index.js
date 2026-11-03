/**
 * Host half of the token usage / cost / CPU statistics module.
 * Contract: docs/usage/README.md.
 *
 * The module only reads real session data below DSH_HOME; it never writes
 * there. Live sessions come from `ctx.sessions.list()` and their in-memory
 * events are fresher than the on-disk log, so they are merged by id with the
 * disk scan (live wins). The CPU sampler runs on a ~2s interval inside the
 * module's effect scope and is disposed with it.
 */
import { Config, readUsageConfig } from "./config.js";
import { CpuSampler } from "./cpu.js";
import { registerUsageRoute } from "./route.js";
import { UsageScanner } from "./scan.js";
import { buildSnapshot } from "./snapshot.js";

export const name = "toolkit-usage";
export const inject = ["sessions", "webServer", "connection"];

export { Config };

export function apply(ctx, config) {
  const scanner = new UsageScanner({
    getLive: () => listLiveSessions(ctx),
    logger: ctx.logger,
  });
  const sampler = new CpuSampler();

  ctx.effect(() => {
    sampler.start();
    return () => sampler.stop();
  }, "toolkit-usage:cpu");

  ctx.effect(() => () => scanner.dispose(), "toolkit-usage:scan-cache");

  registerUsageRoute(ctx, async () => {
    // Volatile settings: read per request so a saved settings form applies on
    // the next poll without reloading the Loader entry.
    const settings = readUsageConfig(config);
    const scan = await scanner.scan();
    return buildSnapshot({ config: settings, scan, cpu: sampler.snapshot(), generatedAt: Date.now() });
  });
}

function listLiveSessions(ctx) {
  try {
    const sessions = ctx.sessions?.list?.();
    return Array.isArray(sessions) ? sessions : [];
  } catch (error) {
    ctx.logger?.warn?.("[usage] could not list live sessions", error);
    return [];
  }
}

export default { name, inject, Config, apply };
