/**
 * 任务监控的三条路由：读快照、加来源、移来源。
 *
 * 状态码只在这一层决定：域层给稳定数字业务码，这里一张表折算 HTTP。
 * client 读 code 与 detail，不解析文案反推状态。
 */
import type { JsonRouteSpec } from '../../../../host/routes.js';
import type { MonitorStore } from '../domain/store.js';
export declare function createMonitorRoutes({ store }: {
    store: MonitorStore;
}): JsonRouteSpec[];
//# sourceMappingURL=highlights.d.ts.map