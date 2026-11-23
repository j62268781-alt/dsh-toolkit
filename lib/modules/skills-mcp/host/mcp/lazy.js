/**
 * 按需启动（懒加载）的 MCP 服务器。
 *
 * ## 为什么需要这一层
 *
 * `dsh-mcp-client` 是**急切**的：`apply()` 里第一件事就是 `connect` + `tools/list`，连不上就按
 * reconnect 策略退避重试（见 `dsh-mcp-client/lib/types/connection.js`）。Loader 一挂上这个行，
 * 进程就起来了、会话一开始就吃内存 —— 哪怕这一轮根本不会用到那台服务器的任何工具。
 *
 * 内核没有懒加载开关（Config 里没有 lazy / onDemand 这类字段），所以「开着但不启动」只能在
 * 上层做，而能做到的前提是两件事：
 *
 *   1. **工具清单可以缓存**：身份可确认且仍新鲜的清单能跨重启复用；否则先按作用域获取清单。
 *      清单只用于注册同名代理，所有执行仍由真实 MCP 客户端负责；
 *   2. **工具注册可以在运行时增删**：`ctx.tools.register()` 返回的 disposer 是 `ctx.effect` 层，
 *      随时撤掉都不影响当前这一步已经快照过的执行。
 *
 * ## 一次调用的时序
 *
 * ```
 * 模型调用 mcp__x__t
 *   → 代理 execute()：撤掉这台服务器的**全部**代理（否则真客户端注册同名工具会冲突）
 *   → mount()（host.plugin(mcp-client, …)）→ 等 fiber 激活 / 工具出现
 *   → 刷新缓存 → 直接调用真实定义的 execute(args, exec)（复用原始取消信号）
 *   → idle 超时后 unmount，回到「只有缓存、没有进程」的状态
 * ```
 *
 * ## 有缓存才懒，没缓存先连一次
 *
 * 第一次见到的服务器没有清单，代理就成了空壳：模型看不到任何工具，也就永远不会触发「首次调用」。
 * 缓存未命中时先读一次短连接的清单；不支持等价短连接的服务器走真实客户端预热。配置或授权变化
 * 会撤掉旧代理。只在当前作用域把过期清单保留为发现提示；代理的执行总是重新查找真实工具。
 *
 * ## 已知取舍
 *
 *   · 工具清单是快照：服务器新增/删除了工具，面板要等到下一次真正连接才看得到；
 *   · 首次调用要多等一次握手（默认最多 30s，超时给明确错误并退回代理状态）；
 *   · 代理通过 `createMcpToolDefinition` 之外的包装转发**真实定义**的 `execute` / `output` /
 *     `projectContent`，所以图片、结构化结果这些由真实定义负责的行为不会退化。
 *
 * @module dsh-toolkit-skills-mcp/mcp/lazy
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { catalogFresh } from './toolCache.js';
import { SINGLE_ENTRY, singleEntryDefinition } from './singleEntry.js';
export { createToolCache, cacheFile } from './toolCache.js';
/**
 * 一台服务器的连接配置指纹。
 *
 * 只算那些**会改变工具清单**的字段：换 URL / headers / 启动命令 / 参数 / 环境变量都可能换出一套
 * 不同的工具，而 `failOnStartupError`、`reconnect`、超时这类纯策略字段不影响清单，不该让缓存作废。
 */
export function fingerprintOf(server) {
    const material = JSON.stringify({
        transport: String(server?.transport ?? ''),
        url: String(server?.url ?? ''),
        command: String(server?.command ?? ''),
        args: Array.isArray(server?.args) ? server.args.map(String) : [],
        env: server?.env ?? {},
        headers: server?.headers ?? {},
        runtime: String(server?.runtime ?? 'system'),
        allowInsecureTokenEndpoint: server?.allowInsecureTokenEndpoint === true,
    });
    return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
/** 全局 scope 的键（agent 对象本身作为其它 scope 的键）。 */
const ROOT = Symbol('root');
// Mirrors the installed host's deterministic DeepSeek public-name contract.
function publicToolName(serverName, rawName) {
    const joined = `mcp__${serverName}__${rawName}`;
    const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
    if (normalized === joined && normalized.length <= 64)
        return normalized;
    return `${normalized.slice(0, 51)}_${createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)}`;
}
function normalizedUrl(value) {
    try {
        return new URL(String(value)).href;
    }
    catch {
        return null;
    }
}
const toolPrefix = (serverName) => `mcp__${String(serverName ?? '')}__`;
/**
 * 建一个懒加载运行时。
 *
 * 依赖全部注入：`mount(server, agent)` 负责真的挂 `mcp-client`，`schemas(agent)` 读工具注册表，
 * `now` / `idleMs` 决定回收时机 —— 于是整台状态机可以脱离宿主单测。
 */
export function createLazyRuntime(deps) {
    const ctx = deps.ctx;
    const warn = typeof deps.warn === 'function' ? deps.warn : () => { };
    const info = typeof deps.info === 'function' ? deps.info : () => { };
    const cache = deps.cache;
    const mount = deps.mount;
    /**
     * 造工具定义的工厂：**注入**而不是 import。
     *
     * `createMcpToolDefinition` 来自 `@deepseek-ai/dsh-mcp-client`，而集成测试用 esbuild 插件把那个
     * 包换成了 fixture —— 直接 import 会让每个只测懒加载的用例都被整个客户端包绑住。注入后这一层
     * 只依赖「一个能把缓存条目变成合法 ToolDefinition 的函数」，测试里给个假的就是了。
     */
    const createToolDefinition = typeof deps.createToolDefinition === 'function' ? deps.createToolDefinition : null;
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const idleMs = deps.idleMs > 0 ? deps.idleMs : 10 * 60_000;
    const startupTimeoutMs = Number.isFinite(deps.startupTimeoutMs) && deps.startupTimeoutMs > 0 ? deps.startupTimeoutMs : 30_000;
    const sleepMs = Number.isFinite(deps.sleepMs) && deps.sleepMs > 0 ? deps.sleepMs : 40;
    /** scope → serverName → state。 */
    const scopes = new Map();
    let disposed = false;
    let stopEntry;
    let warnedEntry = false;
    const single = (server) => server.singleMcpEntry === true && typeof deps.singleDispatch === 'function';
    const projections = new WeakMap();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const toolsOf = (agent) => {
        const host = agent?.ctx ?? ctx;
        try {
            return host?.tools ?? null;
        }
        catch {
            return null;
        }
    };
    const schemasOf = (agent) => {
        const registry = toolsOf(agent);
        if (registry === null || typeof registry.schemas !== 'function')
            return [];
        try {
            const list = registry.schemas(agent ?? undefined);
            return Array.isArray(list) ? list : [];
        }
        catch (error) {
            warn(`cannot read the tool registry: ${String(error?.message ?? error)}`);
            return [];
        }
    };
    const liveDefinition = (state, name) => {
        const registry = toolsOf(state.agent);
        if (registry === null || typeof registry.get !== 'function')
            return undefined;
        try {
            return registry.get(name, state.agent ?? undefined) ?? undefined;
        }
        catch {
            return undefined;
        }
    };
    const disposeProxies = (state) => {
        for (const stop of state.stops.values()) {
            try {
                stop();
            }
            catch (error) {
                warn(`cannot withdraw a lazy proxy: ${String(error?.message ?? error)}`);
            }
        }
        state.stops.clear();
    };
    const teardown = (state) => {
        state.epoch++;
        state.abort?.abort();
        state.abort = null;
        const stop = state.stop;
        state.stop = null;
        state.fiber = null;
        state.hidden?.clear();
        state.hidden = undefined;
        state.status = 'idle';
        state.pending = null;
        if (stop !== null) {
            try {
                stop();
            }
            catch (error) {
                warn(`cannot unmount the lazy MCP server ${state.server?.serverName}: ${String(error?.message ?? error)}`);
            }
        }
    };
    /** 用缓存把同名代理注册回来。没有缓存就什么都不做（等预热）。 */
    const registerProxies = (state) => {
        if (disposed || !state.alive || single(state.server))
            return 0;
        const cached = state.catalog;
        if (cached === null || cached.tools.length === 0)
            return 0;
        if (createToolDefinition === null) {
            // 宿主没提供工厂（旧版本 / 测试替身）：没有代理就没有工具，但绝不能因此中断 apply。
            warn('lazy MCP proxies need a createToolDefinition factory; the cached tools stay unregistered');
            return 0;
        }
        const registry = toolsOf(state.agent);
        if (registry === null || typeof registry.register !== 'function')
            return 0;
        const host = state.agent?.ctx ?? ctx;
        let count = 0;
        for (const tool of cached.tools) {
            if (state.stops.has(tool.name))
                continue;
            /**
             * 名字被**别人**占着就跳过，下一轮 attach 再试。
             *
             * 这不是防御性编程，而是「把一台正在连接的服务器切成懒加载」时的真实竞态：行刚被写成
             * `disabled: true`，Loader 卸载真客户端是异步的，而它的工具此刻还挂在注册表里。硬注册
             * 只会抛错、留下半套代理，之后每轮都撞同一个名字。让它在名字空出来的那一轮补上即可。
             */
            if (typeof registry.get === 'function' && registry.get(tool.name, state.agent ?? undefined) !== undefined)
                continue;
            // 真实定义的 output / projectContent 只有连上之后才有；先给一个合法的兜底，
            // 渲染时（execute 之后）getter 会换成真实定义的那一份。
            const fallback = createToolDefinition(host, {
                name: tool.name,
                rawName: tool.rawName ?? (tool.name.startsWith(toolPrefix(state.server?.serverName))
                    ? tool.name.slice(toolPrefix(state.server?.serverName).length)
                    : tool.name),
                description: tool.description ?? '',
                inputSchema: tool.parameters ?? { type: 'object' },
                call: async () => ({ content: [{ type: 'text', text: 'lazy proxy placeholder' }] }),
            });
            let live = null;
            const epoch = state.epoch;
            const proxy = {
                name: tool.name,
                description: tool.description ?? '',
                parameters: tool.parameters ?? { type: 'object' },
                get output() {
                    return live?.output ?? fallback.output;
                },
                execute: async (args, exec) => {
                    if (!state.alive || state.epoch !== epoch)
                        throw new Error('MCP configuration changed; retry with the current tool list');
                    const target = await ensure(state, tool.name, exec, (definition) => {
                        live = definition;
                    });
                    return target.execute(args, exec);
                },
                projectContent: (exec, result) => live?.projectContent?.(exec, result),
            };
            try {
                state.stops.set(tool.name, registry.register(proxy, {
                    when: async (step) => {
                        if (!state.alive || state.epoch !== epoch)
                            return false;
                        if (state.protocolCatalog && state.catalog && !catalogFresh(state.catalog, state.server.manualToolCache === true, now())) {
                            let job = state.admissions.get(step);
                            if (!job) {
                                job = state.pending ?? warm(state, true);
                                state.admissions.set(step, job);
                            }
                            try {
                                await withAbort(job, step.signal);
                            }
                            catch {
                                return false;
                            }
                        }
                        // The host snapshots registrations before testing conditions. New or changed
                        // definitions become visible next step, not through a stale definition here.
                        return state.alive && state.epoch === epoch && liveDefinition(state, tool.name) === proxy;
                    },
                }));
                count += 1;
            }
            catch (error) {
                warn(`cannot register the lazy proxy ${tool.name}: ${String(error?.message ?? error)}`);
            }
        }
        return count;
    };
    /** 等一次连接（single-flight）：期间所有调用共用同一个 promise。 */
    const ensure = async (state, toolName, exec, onLive) => {
        if (!state.alive || disposed)
            throw new Error('This lazy MCP tool is no longer configured');
        const epoch = state.epoch;
        if (state.status === 'connected') {
            const live = liveDefinition(state, toolName);
            if (live !== undefined) {
                state.lastUsedAt = now();
                onLive?.(live);
                return live;
            }
        }
        if (state.pending === null) {
            const run = connect(state);
            state.pending = run;
            // 两个分支都要有处理器：`finally()` 会把拒绝再派生一次，而那次没人接 —— 调用方
            // 拿到的是 `pending` 上的拒绝，派生出来的那个会变成 unhandledRejection。
            const settle = () => {
                if (state.pending === run)
                    state.pending = null;
            };
            void run.then(settle, settle);
        }
        await withAbort(state.pending, exec?.signal);
        if (!state.alive || state.epoch !== epoch)
            throw new Error('MCP configuration changed while connecting');
        const live = liveDefinition(state, toolName);
        if (live === undefined) {
            throw new Error(`mcp-server "${state.server?.serverName}" started but did not register tool "${toolName}"`);
        }
        state.lastUsedAt = now();
        onLive?.(live);
        return live;
    };
    const liveTools = (state) => (state.hidden ? [...state.hidden.values()] : schemasOf(state.agent))
        .filter((schema) => typeof schema?.name === 'string' && schema.name.startsWith(toolPrefix(state.server.serverName)))
        .map((schema) => ({ name: schema.name, description: String(schema.description ?? ''), parameters: schema.parameters ?? { type: 'object' } }));
    const saveLive = (state, tools) => {
        const previous = state.catalog;
        const byName = (entries) => new Map(entries.map((tool) => [tool.name, tool]));
        const old = byName(previous?.tools ?? []);
        if (previous !== null && old.size === tools.length && tools.every((tool) => {
            const before = old.get(tool.name);
            return before?.description === tool.description && isDeepStrictEqual(before.parameters, tool.parameters);
        }))
            return;
        // The registry shows definitions, not protocol TTL. A live list change supersedes the disk snapshot.
        state.protocolCatalog = false;
        state.catalog = { tools, capturedAt: now(), ttlMs: null, cacheScope: null };
        void cache.drop(state.key);
    };
    const connect = async (state) => {
        if (disposed || !state.alive)
            throw new Error('lazy MCP runtime is disposed');
        const serverName = String(state.server?.serverName ?? '');
        const epoch = state.epoch;
        state.status = 'starting';
        state.error = '';
        disposeProxies(state);
        try {
            if (single(state.server))
                state.hidden = new Map();
            const handle = mount(state.server, state.agent, state.hidden);
            state.stop = handle?.stop ?? (typeof handle === 'function' ? handle : null);
            state.fiber = handle?.fiber ?? null;
            const deadline = now() + startupTimeoutMs;
            while (now() < deadline) {
                if (!state.alive || state.epoch !== epoch)
                    throw new Error('MCP connection superseded');
                const phase = fiberPhase(state.fiber);
                if (phase === 3)
                    throw new Error(`mcp-server "${serverName}" failed to activate`);
                const tools = liveTools(state);
                if (phase === 2 || (phase === undefined && tools.length > 0)) {
                    saveLive(state, tools);
                    state.status = 'connected';
                    state.lastUsedAt = now();
                    info(`mcp server ${serverName}: connected on demand (${tools.length ? `${tools.length} tools` : 'no tools'})`);
                    return;
                }
                await sleep(sleepMs);
            }
            throw new Error(`mcp-server "${serverName}" did not finish connecting within ${startupTimeoutMs}ms`);
        }
        catch (error) {
            if (state.epoch === epoch) {
                teardown(state);
                state.error = String(error?.message ?? error);
                registerProxies(state);
            }
            throw new Error(`mcp-server "${serverName}" could not be mounted: ${String(error?.message ?? error)}`);
        }
    };
    const warm = (state, refresh = false) => {
        const epoch = state.epoch;
        const abort = new AbortController();
        state.abort = abort;
        state.attempted = true;
        state.status = 'starting';
        state.error = '';
        const current = () => state.alive && state.epoch === epoch;
        const manual = state.server.manualToolCache === true;
        const run = Promise.resolve().then(async () => {
            try {
                const auth = await deps.catalogAuth?.(state.server);
                if (!current())
                    return;
                const identity = deps.catalogIdentity?.(state.server, auth) ?? null;
                const hit = refresh ? null : cache.get(state.key, state.fingerprint, identity, manual, now());
                if (hit !== null)
                    state.catalog = hit;
                else if (typeof deps.readCatalog === 'function') {
                    const raw = await deps.readCatalog(state.server, state.agent, auth, abort.signal);
                    if (!current())
                        return;
                    const next = {
                        capturedAt: raw.capturedAt, ttlMs: raw.ttlMs, cacheScope: raw.cacheScope,
                        tools: raw.tools.map((tool) => ({
                            name: publicToolName(state.server.serverName, tool.name), rawName: tool.name,
                            description: typeof tool.description === 'string' ? tool.description : '', parameters: tool.inputSchema,
                        })),
                    };
                    const nextTools = new Map(next.tools.map((tool) => [tool.name, tool]));
                    for (const tool of state.catalog?.tools ?? []) {
                        if (isDeepStrictEqual(tool, nextTools.get(tool.name)))
                            continue;
                        state.stops.get(tool.name)?.();
                        state.stops.delete(tool.name);
                    }
                    state.catalog = next;
                    void cache.put(state.key, state.fingerprint, identity === raw.authorizationIdentity ? identity : null, next, manual);
                }
                if (!current())
                    return;
                if (state.catalog !== null) {
                    state.status = 'idle';
                    state.protocolCatalog = true;
                    registerProxies(state);
                    return;
                }
            }
            catch {
                if (!current())
                    return;
            }
            state.protocolCatalog = false;
            state.catalog = null;
            void cache.drop(state.key);
            await connect(state);
        });
        state.pending = run;
        const settle = () => {
            if (state.pending === run)
                state.pending = null;
            if (state.abort === abort)
                state.abort = null;
        };
        void run.then(settle, (error) => {
            settle();
            if (current() || state.error)
                warn(`mcp server ${state.server.serverName}: warm-up failed: ${String(error)}`);
        });
        return run;
    };
    const stateFor = (scopeKey, server) => {
        let map = scopes.get(scopeKey);
        if (map === undefined) {
            map = new Map();
            scopes.set(scopeKey, map);
        }
        const serverName = String(server?.serverName ?? '');
        let state = map.get(serverName);
        if (state === undefined) {
            state = {
                server, agent: scopeKey === ROOT ? null : scopeKey, fingerprint: '', status: 'idle',
                stops: new Map(), stop: null, fiber: null, pending: null, lastUsedAt: 0, error: '',
                key: '', epoch: 0, alive: true, catalog: null, attempted: false, abort: null,
                admissions: new WeakMap(), protocolCatalog: false, hidden: undefined, activeCalls: 0,
            };
            map.set(serverName, state);
        }
        return state;
    };
    const reset = (state) => {
        teardown(state);
        disposeProxies(state);
        state.catalog = null;
        state.protocolCatalog = false;
        state.attempted = false;
        void cache.drop(state.key);
    };
    const visibleStates = (agent) => {
        const visible = new Map(scopes.get(ROOT));
        for (const [name, state] of scopes.get(agent) ?? [])
            visible.set(name, state);
        return [...visible.values()].filter((state) => state.alive && single(state.server));
    };
    const allowed = (state, name) => deps.admitSingleTool?.(state.server, name) === true;
    const discover = async (state, signal) => {
        const epoch = state.epoch;
        if (state.pending)
            await withAbort(state.pending, signal);
        else if (state.status !== 'connected' && (!state.catalog || !catalogFresh(state.catalog, state.server.manualToolCache === true, now()))) {
            await withAbort(warm(state, state.attempted), signal);
        }
        signal.throwIfAborted();
        if (!state.alive || state.epoch !== epoch)
            throw new Error('MCP configuration changed; retry discovery');
        return (state.status === 'connected' ? liveTools(state) : state.catalog?.tools ?? []).filter((tool) => allowed(state, tool.name));
    };
    const executeEntry = async (args, exec) => {
        exec.signal.throwIfAborted();
        const states = visibleStates(exec.agent);
        const requested = typeof args?.server === 'string' ? args.server : undefined;
        const selected = requested === undefined ? states : states.filter((state) => state.server.serverName === requested);
        if (requested !== undefined && selected.length === 0)
            throw new Error('MCP server is not available in this scope');
        if (args?.action === 'search') {
            const query = typeof args.query === 'string' ? args.query.slice(0, 200).trim().toLowerCase() : '';
            const tools = [];
            const unavailable = [];
            for (const state of selected) {
                let catalog;
                try {
                    catalog = await discover(state, exec.signal);
                }
                catch {
                    exec.signal.throwIfAborted();
                    unavailable.push(state.server.serverName);
                    continue;
                }
                for (const tool of catalog) {
                    const server = state.server.serverName;
                    if (!`${server} ${tool.name} ${tool.description}`.toLowerCase().includes(query))
                        continue;
                    tools.push({ server, tool: tool.name, description: tool.description.slice(0, 300) });
                    if (tools.length === 30)
                        return { tools, unavailable, truncated: true };
                }
            }
            return { tools, unavailable };
        }
        const state = requested !== undefined ? selected[0] : undefined;
        const name = typeof args?.tool === 'string' ? args.tool : '';
        if (!state || !name || (args?.action !== 'describe' && args?.action !== 'call'))
            throw new Error('Use search or supply server and tool for describe/call');
        if (!allowed(state, name))
            throw new Error('MCP tool is not available in this scope');
        const listed = (await discover(state, exec.signal)).find((tool) => tool.name === name);
        if (!listed || !visibleStates(exec.agent).includes(state))
            throw new Error('MCP tool is not available in this scope');
        if (args.action === 'describe')
            return { server: requested, tool: name, description: listed.description, parameters: listed.parameters };
        const epoch = state.epoch;
        const current = () => state.alive && state.epoch === epoch && visibleStates(exec.agent).includes(state) && allowed(state, name);
        if (!current())
            throw new Error('MCP tool is not available in this scope');
        state.activeCalls++;
        try {
            if (state.status !== 'connected') {
                if (state.pending === null) {
                    const run = connect(state);
                    state.pending = run;
                    const settle = () => { if (state.pending === run)
                        state.pending = null; };
                    void run.then(settle, settle);
                }
                await withAbort(state.pending, exec.signal);
            }
            exec.signal.throwIfAborted();
            const definition = state.hidden?.get(name);
            const resolve = () => current() && state.hidden?.get(name) === definition
                && toolsOf(exec.agent)?.get(name, exec.agent) === definition ? definition : undefined;
            if (!definition || resolve() !== definition)
                throw new Error('MCP tool is not available in this scope');
            const result = await deps.singleDispatch(definition, args.args ?? {}, exec, resolve);
            if (result.content !== undefined)
                projections.set(exec, result);
            return result.value;
        }
        finally {
            state.activeCalls--;
            state.lastUsedAt = now();
        }
    };
    const reconcileEntry = () => {
        const wanted = [...scopes.values()].some((map) => [...map.values()].some((state) => single(state.server)));
        if (!wanted) {
            stopEntry?.();
            stopEntry = undefined;
            return;
        }
        if (stopEntry)
            return;
        try {
            const registry = toolsOf(null);
            if (!registry || registry.get?.(SINGLE_ENTRY) !== undefined)
                throw new Error('mcp is already registered or the tool registry is unavailable');
            stopEntry = registry.register(singleEntryDefinition(executeEntry, projections), {
                when: (step) => visibleStates(step?.agent).length > 0,
            });
        }
        catch (error) {
            if (!warnedEntry)
                warn(`cannot register single MCP entry: ${String(error?.message ?? error)}`);
            warnedEntry = true;
        }
    };
    return {
        /**
         * 对账一个 scope 的懒服务器集合。
         *
         * @param agent - `null` 表示全局 scope（工具注册在插件自己的上下文里）。
         * @param servers - 这个 scope 下**该由本插件挂载**的懒服务器（已过滤 enabled）。
         */
        attach(agent, servers) {
            if (disposed)
                return;
            const scopeKey = agent === null || agent === undefined ? ROOT : agent;
            let map = scopes.get(scopeKey);
            if (map === undefined) {
                map = new Map();
                scopes.set(scopeKey, map);
            }
            const wanted = new Set();
            for (const server of Array.isArray(servers) ? servers : []) {
                const serverName = String(server?.serverName ?? '');
                if (serverName === '')
                    continue;
                wanted.add(serverName);
                const state = stateFor(scopeKey, server);
                const fingerprint = fingerprintOf(server);
                const namespace = typeof deps.namespace === 'function' ? deps.namespace() : deps.namespace;
                const key = JSON.stringify([namespace ?? '', server.scope ?? 'global', server.entryId ?? '', serverName]);
                const changed = state.fingerprint !== '' && (state.fingerprint !== fingerprint || state.key !== key
                    || single(state.server) !== single(server)
                    || (state.server.manualToolCache === true && server.manualToolCache !== true));
                if (changed)
                    reset(state);
                state.server = server;
                state.fingerprint = fingerprint;
                state.key = key;
                if (server.singleMcpEntry === true && !single(server) && !warnedEntry) {
                    warn('single MCP entry is unavailable on this Host; using ordinary lazy tools');
                    warnedEntry = true;
                }
                if (state.status === 'idle' && !single(server)) {
                    if (!state.attempted)
                        void warm(state);
                    else
                        registerProxies(state);
                }
            }
            for (const [serverName, state] of [...map.entries()]) {
                if (wanted.has(serverName))
                    continue;
                state.alive = false;
                teardown(state);
                disposeProxies(state);
                map.delete(serverName);
            }
            if (map.size === 0)
                scopes.delete(scopeKey);
            reconcileEntry();
        },
        async refresh(serverName, project, projectScope) {
            const jobs = [];
            for (const [scope, map] of scopes) {
                if (project !== undefined && project !== (scope !== ROOT))
                    continue;
                const state = map.get(serverName);
                if (!state || (project && projectScope && state.server.scope !== projectScope))
                    continue;
                reset(state);
                jobs.push(warm(state));
            }
            await Promise.all(jobs);
            return jobs.length;
        },
        authorizationChanged(url) {
            const endpoint = normalizedUrl(url);
            if (endpoint === null)
                return;
            for (const map of scopes.values()) {
                for (const state of map.values()) {
                    if (state.server.transport === 'stdio' || normalizedUrl(state.server.url) !== endpoint)
                        continue;
                    reset(state);
                    if (!single(state.server))
                        void warm(state);
                }
            }
        },
        /** 丢掉一个 agent 的全部懒状态（会话结束）。 */
        detach(agent) {
            const map = scopes.get(agent);
            if (map === undefined)
                return;
            for (const state of map.values()) {
                state.alive = false;
                teardown(state);
                disposeProxies(state);
            }
            scopes.delete(agent);
            reconcileEntry();
        },
        /** 回收空闲连接。由宿主的慢 tick 调用。 */
        sweep() {
            if (disposed)
                return 0;
            const at = now();
            let closed = 0;
            for (const map of scopes.values()) {
                for (const state of map.values()) {
                    if (state.status !== 'connected' || state.activeCalls > 0)
                        continue;
                    if (at - state.lastUsedAt < idleMs)
                        continue;
                    saveLive(state, liveTools(state));
                    teardown(state);
                    disposeProxies(state);
                    registerProxies(state);
                    closed += 1;
                    info(`mcp server ${state.server?.serverName}: idle for ${Math.round((at - state.lastUsedAt) / 1000)}s, disconnected`);
                }
            }
            return closed;
        },
        /** 面板要的每台服务器状态（跨 scope 合并，连接中的优先）。 */
        snapshot() {
            const out = {};
            const rank = { idle: 0, starting: 1, connected: 2 };
            for (const map of scopes.values()) {
                for (const state of map.values()) {
                    const serverName = String(state.server?.serverName ?? '');
                    if (serverName === '')
                        continue;
                    const current = out[serverName];
                    const entry = {
                        state: state.status,
                        serverName,
                        scope: state.agent === null ? 'global' : String(state.server?.scope ?? ''),
                        cachedTools: 0,
                        capturedAt: '',
                        stale: false,
                        lastUsedAt: state.lastUsedAt === 0 ? '' : new Date(state.lastUsedAt).toISOString(),
                        error: state.error,
                    };
                    const cached = state.catalog;
                    if (cached !== null) {
                        entry.cachedTools = cached.tools.length;
                        entry.capturedAt = new Date(cached.capturedAt).toISOString();
                        entry.stale = !catalogFresh(cached, state.server.manualToolCache === true, now());
                    }
                    if (current === undefined || (rank[entry.state] ?? 0) > (rank[current.state] ?? 0))
                        out[serverName] = entry;
                }
            }
            return out;
        },
        dispose() {
            disposed = true;
            for (const map of scopes.values()) {
                for (const state of map.values()) {
                    state.alive = false;
                    teardown(state);
                    disposeProxies(state);
                }
            }
            scopes.clear();
            reconcileEntry();
        },
    };
}
/** cordis Fiber 的 phase：2 = active，3 = failed，其余（含未知）当作未就绪。 */
function fiberPhase(fiber) {
    if (fiber === null || fiber === undefined || typeof fiber === 'function')
        return undefined;
    return fiber.state;
}
/** 让一个 promise 跟随调用方的取消信号（后台连接不会被取消）。 */
function withAbort(promise, signal) {
    if (signal === undefined || signal === null)
        return promise;
    if (signal.aborted)
        return Promise.reject(signal.reason ?? new Error('the tool call was canceled'));
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error('the tool call was canceled'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
//# sourceMappingURL=lazy.js.map