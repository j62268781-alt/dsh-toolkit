/** Inject the host's mcp-client module. */
export declare function setMountClient(next: any): void;
export declare function mountedKeyOf(servers: any): string;
/**
 * A mount field (`env` / `headers`) as a plain object, whichever shape it arrives in.
 *
 * The two callers hand this module **different** shapes, and assuming one silently dropped the
 * other:
 *
 *   · `serverRows()` produces an already-parsed **object** (`config.env` straight off the row),
 *     which is what the real mount path passes in;
 *   · the panel draft / import path produces `KEY=VALUE` **lines**.
 *
 * `parseEnv({JAVA_HOME: '/jdk'})` returns `{}` — `String(object)` is `"[object Object]"`, which
 * has no `=`, so every line is skipped. That is how issue #2 happened: a project-scoped stdio
 * row's `JAVA_HOME` / `GHIDRA_INSTALL_DIR` never reached the child process, with no error
 * anywhere, while the same values worked on 0.5.4's `config.servers[]` path (which passed
 * strings). Accept both instead of picking one.
 *
 * A `null`/absent value is `{}` either way. Non-string scalars are stringified the same way the
 * YAML reader would, so a numeric value does not become `"[object Object]"`-style garbage.
 */
export declare function envObject(value: any): any;
/**
 * stdio mount config.
 *
 * `npx`-style commands prefer the harness's own runtime (`node` + `pnpx`), which
 * works regardless of the user's shell PATH and of a broken shared npm cache.
 * Anything else resolves through the login shell.
 */
export declare function stdioMountConfig(server: any): {
    transport: string;
    serverName: any;
    command: any;
    args: any;
    env: any;
};
/**
 * Project-level MCP config files, per tool, as those tools document them.
 *
 * Only tools that actually read a project-scoped file are listed; the rest keep
 * their MCP servers in user-level config, which is out of scope for this import.
 */
export declare function serverMountConfig(server: any): any;
/** The agent's working directory, tolerating the Session shapes in play. */
export declare function workingDirectoryOf(agent: any): any;
/**
 * Project-scoped servers that apply to a working directory.
 *
 * A configured project scope is matched as a directory prefix, so a session
 * started anywhere inside the project — not only at its root — gets the servers.
 */
export declare function projectServersFor(servers: any, cwd: any): any;
//# sourceMappingURL=mount.d.ts.map