import { type TaskMonitorEntry, type TaskMonitorFailure, type TaskMonitorResult } from '../constants.js';
import { type ClassifiedSeed } from './classify.js';
export interface TaskMonitorStoreOptions {
    home: string;
    enabled?: () => boolean;
    now?: () => number;
    persistDelayMs?: number;
}
export type AddSourceResult = {
    readonly ok: true;
    readonly entry: TaskMonitorEntry;
} | TaskMonitorFailure;
export type RemoveSourceResult = {
    readonly ok: true;
} | TaskMonitorFailure;
export declare function createTaskMonitorStore(options: TaskMonitorStoreOptions): {
    /** 工具事件聚合入口：失败也只影响监控自己，不碰工具链。 */
    record(sessionId: string, seeds: readonly ClassifiedSeed[], status: "ok" | "failed"): Promise<void>;
    snapshot(sessionId: unknown): Promise<TaskMonitorResult>;
    addSource(sessionId: unknown, kind: unknown, value: unknown): Promise<AddSourceResult>;
    removeSource(sessionId: unknown, id: unknown): Promise<RemoveSourceResult>;
    flush: (sessionId: string) => Promise<void>;
    dispose(): Promise<void>;
};
export type TaskMonitorStore = ReturnType<typeof createTaskMonitorStore>;
//# sourceMappingURL=store.d.ts.map