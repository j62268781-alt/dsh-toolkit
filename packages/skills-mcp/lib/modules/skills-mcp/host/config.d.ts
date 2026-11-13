import z from '@deepseek-ai/schemastery';
/** One queued change against a row the profile itself configures. */
export declare const RowOp: z<Schemastery.ObjectS<NoInfer<{
    op: z<"delete" | "update" | "add" | "toggle", "delete" | "update" | "add" | "toggle", "plain">;
    /** delete/update: the row to touch; add: the id for the new row (blank = derive). */
    entryId: z<string, string, "defined">;
    serverName: z<string, string, "defined">;
    transport: z<string, string, "defined">;
    url: z<string, string, "defined">;
    command: z<string, string, "defined">;
    /** stdio arguments, space separated (the panel's form shape). */
    args: z<string, string, "defined">;
    /** extra child environment, one KEY=VALUE per line. */
    env: z<string, string, "defined">;
    /** HTTP headers, one KEY=VALUE per line. */
    headers: z<string, string, "defined">;
    /**
     * stdio 用哪个 npm 家族：`system`（默认）或 `auto`（跟随 Harness 自带的 node + pnpx）。
     *
     * 这个字段**原先根本不存在**，于是面板上那个「运行时」下拉是个纯装饰：选择写进 draft、
     * 却既不进 RowOp 也不落盘，Host 一律按默认分支走。用户的直觉是对的 —— 选什么都不生效，
     * 那就是 bug。
     *
     * `system` 是默认值，因为 `auto` 走 pnpx 时解析到的 pnpm store 里依赖没有链接进去：
     * `server-memory` / `server-filesystem` 会 `Cannot find package 'zod'` 直接退出。
     * 只有系统找不到 npx 时才回落到 pnpx（见 src/project/mount.js）。
     */
    runtime: z<string, string, "defined">;
    /** Connection policy written into the row's config (see src/mcp/connection.js). */
    failOnStartupError: z<boolean, boolean, "defined">;
    reconnectInitialDelayMs: z<string, string, "defined">;
    reconnectMaxDelayMs: z<string, string, "defined">;
    reconnectMaxAttempts: z<string, string, "defined">;
    /** Per-call tool timeout for this server ('' = the client's own default). */
    toolCallTimeoutMs: z<string, string, "defined">;
    /**
     * 这台服务器的 token 端点允许**明文 http**（非回环地址）。
     *
     * 默认关闭，且**这是唯一能开启它的地方**：每台服务器自己的字段，不存在全局开关。
     * 开启后 OAuth 的 token 交换（含 refresh）会把 `access_token` / `refresh_token` 以
     * 明文发到内网 —— 同网段任何能嗅探的设备都能读到。SDK 的 `assertSecureTokenEndpoint`
     * 无条件拒绝这种端点（这是对的），所以本插件用 `src/mcp/oauth/insecure.js` 自己完成那一步，
     * 每次明文请求都记一条 warning。
     *
     * 存在的理由：内网部署的授权服务器（如 MCPHub）常常没有 TLS，而它既不是回环地址、
     * 也不会升级 https。没有这个例外，那类服务器在 OAuth 上完全不可用。
     */
    allowInsecureTokenEndpoint: z<boolean, boolean, "defined">;
    /**
     * update: whether the user actually edited the connection fields.
     *
     * Defaults to false on purpose: a form whose fields were not prefilled (an older
     * Host does not project them) must not wipe a configured value on an unrelated
     * edit, and a missing flag is the recoverable direction.
     */
    connectionChanged: z<boolean, boolean, "defined">;
    /** toggle: the desired enabled state of the row. */
    enabled: z<boolean, boolean, "defined">;
    /**
     * add/update: the row's tier. `global` (or empty) leaves the key off, which is what a
     * row without a `scope` already means — so existing rows stay valid untouched.
     */
    scope: z<string, string, "defined">;
    /** update: whether the user actually changed the tier (blank = leave it alone). */
    scopeChanged: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    op: z<"delete" | "update" | "add" | "toggle", "delete" | "update" | "add" | "toggle", "plain">;
    /** delete/update: the row to touch; add: the id for the new row (blank = derive). */
    entryId: z<string, string, "defined">;
    serverName: z<string, string, "defined">;
    transport: z<string, string, "defined">;
    url: z<string, string, "defined">;
    command: z<string, string, "defined">;
    /** stdio arguments, space separated (the panel's form shape). */
    args: z<string, string, "defined">;
    /** extra child environment, one KEY=VALUE per line. */
    env: z<string, string, "defined">;
    /** HTTP headers, one KEY=VALUE per line. */
    headers: z<string, string, "defined">;
    /**
     * stdio 用哪个 npm 家族：`system`（默认）或 `auto`（跟随 Harness 自带的 node + pnpx）。
     *
     * 这个字段**原先根本不存在**，于是面板上那个「运行时」下拉是个纯装饰：选择写进 draft、
     * 却既不进 RowOp 也不落盘，Host 一律按默认分支走。用户的直觉是对的 —— 选什么都不生效，
     * 那就是 bug。
     *
     * `system` 是默认值，因为 `auto` 走 pnpx 时解析到的 pnpm store 里依赖没有链接进去：
     * `server-memory` / `server-filesystem` 会 `Cannot find package 'zod'` 直接退出。
     * 只有系统找不到 npx 时才回落到 pnpx（见 src/project/mount.js）。
     */
    runtime: z<string, string, "defined">;
    /** Connection policy written into the row's config (see src/mcp/connection.js). */
    failOnStartupError: z<boolean, boolean, "defined">;
    reconnectInitialDelayMs: z<string, string, "defined">;
    reconnectMaxDelayMs: z<string, string, "defined">;
    reconnectMaxAttempts: z<string, string, "defined">;
    /** Per-call tool timeout for this server ('' = the client's own default). */
    toolCallTimeoutMs: z<string, string, "defined">;
    /**
     * 这台服务器的 token 端点允许**明文 http**（非回环地址）。
     *
     * 默认关闭，且**这是唯一能开启它的地方**：每台服务器自己的字段，不存在全局开关。
     * 开启后 OAuth 的 token 交换（含 refresh）会把 `access_token` / `refresh_token` 以
     * 明文发到内网 —— 同网段任何能嗅探的设备都能读到。SDK 的 `assertSecureTokenEndpoint`
     * 无条件拒绝这种端点（这是对的），所以本插件用 `src/mcp/oauth/insecure.js` 自己完成那一步，
     * 每次明文请求都记一条 warning。
     *
     * 存在的理由：内网部署的授权服务器（如 MCPHub）常常没有 TLS，而它既不是回环地址、
     * 也不会升级 https。没有这个例外，那类服务器在 OAuth 上完全不可用。
     */
    allowInsecureTokenEndpoint: z<boolean, boolean, "defined">;
    /**
     * update: whether the user actually edited the connection fields.
     *
     * Defaults to false on purpose: a form whose fields were not prefilled (an older
     * Host does not project them) must not wipe a configured value on an unrelated
     * edit, and a missing flag is the recoverable direction.
     */
    connectionChanged: z<boolean, boolean, "defined">;
    /** toggle: the desired enabled state of the row. */
    enabled: z<boolean, boolean, "defined">;
    /**
     * add/update: the row's tier. `global` (or empty) leaves the key off, which is what a
     * row without a `scope` already means — so existing rows stay valid untouched.
     */
    scope: z<string, string, "defined">;
    /** update: whether the user actually changed the tier (blank = leave it alone). */
    scopeChanged: z<boolean, boolean, "defined">;
}>>, "plain">;
/**
 * One skill write request, validated by the `POST /<name>/skills` route.
 *
 * Plain schema (no `.volatile()`): a volatile schemastery schema returns `{}` when called,
 * which would strip `scope`/`id` and make every write answer 「未知的写入区域」. The same
 * distinction once cost this repository a full debugging round.
 */
export declare const SkillRequest: z<Schemastery.ObjectS<NoInfer<{
    op: z<string, string, "defined">;
    scope: z<string, string, "defined">;
    id: z<string, string, "defined">;
    project: z<string, string, "defined">;
    /**
     * The `SKILL.md` path for `op: 'read'` — the editor and the preview send only this.
     *
     * It was in the inline schema this definition replaced, and dropping it silently broke
     * 「编辑」: the panel sent the read request, validation stripped `path`, and the Host answered
     * 「该技能不在当前扫描结果里」. Creating still worked (it goes over HTTP now and never sends
     * `path`), which is exactly why the loss was easy to miss.
     */
    path: z<string, string, "defined">;
    name: z<string, string, "defined">;
    prevName: z<string, string, "defined">;
    description: z<string, string, "defined">;
    body: z<string, string, "defined">;
    nonce: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    op: z<string, string, "defined">;
    scope: z<string, string, "defined">;
    id: z<string, string, "defined">;
    project: z<string, string, "defined">;
    /**
     * The `SKILL.md` path for `op: 'read'` — the editor and the preview send only this.
     *
     * It was in the inline schema this definition replaced, and dropping it silently broke
     * 「编辑」: the panel sent the read request, validation stripped `path`, and the Host answered
     * 「该技能不在当前扫描结果里」. Creating still worked (it goes over HTTP now and never sends
     * `path`), which is exactly why the loss was easy to miss.
     */
    path: z<string, string, "defined">;
    name: z<string, string, "defined">;
    prevName: z<string, string, "defined">;
    description: z<string, string, "defined">;
    body: z<string, string, "defined">;
    nonce: z<string, string, "defined">;
}>>, "plain">;
/**
 * One OAuth command, as the panel sends it to `POST /<name>/oauth`.
 *
 * Kept as a **plain schema** (no `.volatile()`) for exactly the reason documented on
 * `SkillRequest` above: a `.volatile()` schema returns `{}` when called, so the route's
 * `schema(payload)` would hand `run` an empty object and every command would answer
 * 「未知的 OAuth 操作」. This distinction has already cost this repository one full round of
 * debugging (skill edit/delete), so it is stated here rather than rediscovered.
 *
 * The action set is closed: `authorize`, `status`, `logout`. Finishing an authorization is
 * **not** a command — it arrives as the authorization server's browser redirect, which is
 * why it lives in `src/mcp/oauth/callback.js`.
 */
export declare const OAuthCommand: z<Schemastery.ObjectS<NoInfer<{
    action: z<"status" | "authorize" | "logout", "status" | "authorize" | "logout", "plain">;
    serverName: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    action: z<"status" | "authorize" | "logout", "status" | "authorize" | "logout", "plain">;
    serverName: z<string, string, "defined">;
}>>, "plain">;
/** One reconnect command (`POST /<name>/reconnect`). Plain schema: it is a validator. */
export declare const ReconnectRequest: z<Schemastery.ObjectS<NoInfer<{
    tier: z<string, string, "defined">;
    serverName: z<string, string, "defined">;
    scope: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    tier: z<string, string, "defined">;
    serverName: z<string, string, "defined">;
    scope: z<string, string, "defined">;
}>>, "plain">;
/** One import scan request (`POST /<name>/import`). Plain schema: it is a validator. */
export declare const ImportRequest: z<Schemastery.ObjectS<NoInfer<{
    source: z<string, string, "defined">;
    scope: z<string, string, "defined">;
    project: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    source: z<string, string, "defined">;
    scope: z<string, string, "defined">;
    project: z<string, string, "defined">;
}>>, "plain">;
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /**
     * 每个服务器的工具过滤规则：`{ [serverName]: { mode, tools } }`。
     *
     * 这是本插件**唯一**持久化的用户配置。技能与 MCP 行都不再经过 settings：
     *   · 技能 = 磁盘上的 `SKILL.md`；
     *   · MCP = profile patch 里的 Loader 行（面板通过 HTTP 路由直接改该文件）；
     *   · 列表 / 工具 / 连接状态 / 授权状态 = `/runtime` 现算，不落盘。
     *
     * `mode`：`off`（不过滤，默认）/ `allow`（只保留 tools 里的）/ `deny`（只挡 tools 里的）。
     * 面板写入，Host 在注册那一刻据此决定要不要放行。见 `src/mcp/filter.js` 的取舍说明：
     * mcp-client 自身没有白名单字段，`ctx.tools.restrict()` 又要求 scoped 上下文，
     * 所以唯一的接缝是劫持工具服务实例的 `register`。
     */
    toolFilters: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
        mode: z<string, string, "defined">;
        tools: z<string[], string[], "defined">;
    }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        mode: z<string, string, "defined">;
        tools: z<string[], string[], "defined">;
    }>>, string>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /**
     * 每个服务器的工具过滤规则：`{ [serverName]: { mode, tools } }`。
     *
     * 这是本插件**唯一**持久化的用户配置。技能与 MCP 行都不再经过 settings：
     *   · 技能 = 磁盘上的 `SKILL.md`；
     *   · MCP = profile patch 里的 Loader 行（面板通过 HTTP 路由直接改该文件）；
     *   · 列表 / 工具 / 连接状态 / 授权状态 = `/runtime` 现算，不落盘。
     *
     * `mode`：`off`（不过滤，默认）/ `allow`（只保留 tools 里的）/ `deny`（只挡 tools 里的）。
     * 面板写入，Host 在注册那一刻据此决定要不要放行。见 `src/mcp/filter.js` 的取舍说明：
     * mcp-client 自身没有白名单字段，`ctx.tools.restrict()` 又要求 scoped 上下文，
     * 所以唯一的接缝是劫持工具服务实例的 `register`。
     */
    toolFilters: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectS<NoInfer<{
        mode: z<string, string, "defined">;
        tools: z<string[], string[], "defined">;
    }>>, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        mode: z<string, string, "defined">;
        tools: z<string[], string[], "defined">;
    }>>, string>>, "volatile-defined">;
}>>, "plain">;
//# sourceMappingURL=config.d.ts.map