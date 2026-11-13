import { NAME as name } from './identity.js';
export { name };
/** The Loader is core, so requiring it costs nothing and never blocks startup. */
export declare const inject: string[];
export { Config } from './config.js';
/**
 * Reconcile continuously.
 *
 * The settings page writes `.volatile()` fields straight into the running
 * config; that update never re-runs `apply`. So this half reads the live values
 * on a slow tick and re-applies only what actually changed — a save in the panel
 * takes effect within a couple of seconds, and the work stays idempotent.
 *
 * Global servers mount in the root scope (where a configured row lives, so every
 * agent sees their tools). Project servers mount in a matching agent's own scope
 * at `agent/created`, which is how the shipped client scopes tools per agent.
 */
export declare function apply(ctx: any, config: any): void;
//# sourceMappingURL=index.d.ts.map