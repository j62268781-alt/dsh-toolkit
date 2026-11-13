/** Current `$DSH_HOME` (the injected resolver when the host provided one). */
export declare function dshHome(): string;
/** Inject the host application's home resolver. */
export declare function setHomeResolver(resolve: any): void;
/**
 * Resolve a bare stdio command through the user's login shell.
 *
 * A desktop-launched Host inherits PATH=/usr/bin:/bin:/usr/sbin:/sbin, so `npx`
 * and friends are invisible; an absolute path always passes through untouched.
 */
export declare function resolveCommand(command: any): any;
/** The user's login-shell PATH, resolved once. */
export declare function loginPath(): any;
/**
 * Extra child environment for a stdio server.
 *
 * A desktop-launched Host inherits `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, where
 * neither `node` nor `npx` exists — a spawn of `/opt/homebrew/bin/npx` then dies
 * in its `#!/usr/bin/env node` shebang. So every stdio server gets the login
 * shell's PATH.
 */
/** Parse `KEY=VALUE` lines into a child-environment dict. */
export declare function parseEnv(text: any): any;
/** The harness's bundled runtime: Node plus pnpm/pnpx (it ships no npm/npx). */
export declare function bundledRuntime(): any;
export declare function commandEnv(command: any): any;
/** Space-separated argument text -> argv list. */
export declare function splitArgs(text: any): string[];
/**
 * Child environment written into a profile row.
 *
 * A desktop-launched Host runs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, where
 * `node` does not exist — a row with `command: npx` would die in its
 * `#!/usr/bin/env node` shebang. Writing the bundled runtime's bin directory in
 * front of the login PATH makes such a row work with no host-side patching.
 */
export declare function spawnEnv(extra: any): any;
//# sourceMappingURL=env.d.ts.map