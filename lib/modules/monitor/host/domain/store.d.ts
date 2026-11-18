import { type MonitorEntry, type MonitorFailure, type MonitorResult } from '../constants.js';
import { type ClassifiedSeed } from './classify.js';
export interface MonitorStoreOptions {
    home: string;
    enabled?: () => boolean;
    now?: () => number;
    persistDelayMs?: number;
}
export type AddSourceResult = {
    readonly ok: true;
    readonly entry: MonitorEntry;
} | MonitorFailure;
export type RemoveSourceResult = {
    readonly ok: true;
} | MonitorFailure;
export declare function createMonitorStore(options: MonitorStoreOptions): {
    /** 工具事件聚合入口：失败也只影响监控自己，不碰工具链。 */
    record(sessionId: string, seeds: readonly ClassifiedSeed[], status: "ok" | "failed"): Promise<void>;
    snapshot(sessionId: unknown): Promise<MonitorResult>;
    addSource(sessionId: unknown, kind: unknown, value: unknown): Promise<AddSourceResult>;
    removeSource(sessionId: unknown, id: unknown): Promise<RemoveSourceResult>;
    flush: (sessionId: string) => Promise<void>;
    dispose(): Promise<void>;
};
export type MonitorStore = ReturnType<typeof createMonitorStore>;
//# sourceMappingURL=store.d.ts.map