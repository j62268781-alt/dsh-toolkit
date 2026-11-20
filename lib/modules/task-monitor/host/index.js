/**
 * monitor 模块装配：只读订阅工具事件 → 聚合进 store → 挂三条路由。
 *
 * 订阅 `tools/post-execute` 必须把 `next()` 原样交还——我们是观察者，不是决策者，
 * 吞掉 next 会断掉整条工具链。失败观察走宿主指定的 `tools/result`。
 * 子代理的事件按 parentSession 归到主会话，面板才是一个任务一张清单。
 */
import { dshHome } from '../../../host/dsh-home.js';
import { registerJsonRoutes } from '../../../host/routes.js';
import { NAME } from './constants.js';
import { Config, readSettings } from './config.js';
import { absoluteArtifact, workspaceArtifacts } from './domain/artifacts.js';
import { classifyCall } from './domain/classify.js';
import { observeInputSources } from './domain/sources.js';
import { createTaskMonitorStore } from './domain/store.js';
import { createTaskMonitorRoutes } from './routes/highlights.js';
export const name = NAME;
/** 事件监听不需要声明 inject；webServer/connection 走下面的可选注入。 */
export const inject = [];
export { Config };
function sessionOf(agent) {
    const header = agent?.session?.header;
    const parent = header?.parentSession;
    const id = typeof parent === 'string' && parent !== '' ? parent : header?.id;
    return typeof id === 'string' ? id : '';
}
export function apply(ctx, config = {}) {
    const headerCwd = (session) => session?.header?.cwd;
    let cwdOf = headerCwd;
    let sessionOfId = (_id) => undefined;
    ctx.inject(['workingDirectory'], (serviceCtx) => {
        cwdOf = (session) => {
            if (session !== undefined) {
                try {
                    return serviceCtx.workingDirectory.get(session) ?? headerCwd(session);
                }
                catch { /* session is gone */ }
            }
            return headerCwd(session);
        };
        return () => { cwdOf = headerCwd; };
    });
    ctx.inject(['sessions'], (serviceCtx) => {
        sessionOfId = (id) => serviceCtx.sessions.get(id);
        return () => { sessionOfId = () => undefined; };
    });
    const store = createTaskMonitorStore({
        home: dshHome(), enabled: () => readSettings(config).enabled,
        cwdOf: (id) => cwdOf(sessionOfId(id)),
    });
    ctx.on('tools/post-execute', (exec, result, next) => {
        if (result?.isError !== true) {
            const sessionId = sessionOf(exec?.agent);
            const seeds = classifyCall(exec?.name, exec?.arguments);
            if (sessionId !== '' && seeds.length > 0) {
                const cwd = seeds.some(seed => seed.kind === 'artifact') ? cwdOf(exec?.agent?.session) : undefined;
                void store.record(sessionId, seeds.map(seed => absoluteArtifact(seed, cwd)), 'ok');
            }
        }
        return next();
    });
    ctx.on('tools/result', (exec, result) => {
        if (result?.isError !== true)
            return;
        const sessionId = sessionOf(exec?.agent);
        if (sessionId !== '')
            void store.record(sessionId, classifyCall(exec?.name, exec?.arguments), 'failed');
    });
    ctx.inject(['workspaceChanges'], (serviceCtx) => {
        let active = true;
        serviceCtx.on('session/event', (session, event) => {
            if (event?.type !== 'workspace/changes' || typeof event.seq !== 'number')
                return;
            const id = session?.header?.id;
            const owner = sessionOf({ session });
            if (typeof id !== 'string' || owner === '')
                return;
            // 宿主先发事件，随后才把同一个 seq 的摘要放进服务。
            queueMicrotask(() => {
                if (!active)
                    return;
                const summary = serviceCtx.workspaceChanges.summary(id, event.seq);
                void store.record(owner, workspaceArtifacts(summary), 'ok');
            });
        });
        return () => { active = false; };
    });
    // 官方「代码审查和变更」tab 的地址要 (seq, turn)，`workspace/changes` 事件正好带着这两个：
    // 记住最近一次的坐标，面板那行 +N −M 点开的就是它。只记坐标，不碰事件本身（观察者）。
    ctx.on('session/event', (session, event) => {
        if (event?.type !== 'workspace/changes')
            return;
        const sessionId = session?.header?.id;
        if (typeof sessionId !== 'string' || sessionId === '')
            return;
        const seq = event?.seq;
        const turn = event?.data?.turn;
        if (typeof seq !== 'number' || typeof turn !== 'number')
            return;
        store.noteChange(sessionId, seq, turn);
    });
    ctx.on('session/event', observeInputSources((sessionId, seeds) => {
        void store.record(sessionId, seeds, 'ok');
    }));
    ctx.on('agent/disposed', ({ agent }) => {
        const sessionId = sessionOf(agent);
        if (sessionId !== '')
            void store.flush(sessionId);
    });
    // 模块卸载时把防抖窗口里的改动落盘，重启不丢最后几秒的清单。
    ctx.effect(() => () => { void store.dispose(); }, 'dsh-toolkit-task-monitor:flush');
    // 没有 Web 服务时只保留聚合，面板路由缺席不影响工具链。
    ctx.inject(['webServer', 'connection'], (routeCtx) => {
        registerJsonRoutes(routeCtx, createTaskMonitorRoutes({ store }));
    });
}
export default { name, inject, Config, apply };
//# sourceMappingURL=index.js.map