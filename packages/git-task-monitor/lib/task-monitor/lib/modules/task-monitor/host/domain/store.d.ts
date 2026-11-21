import { type TaskMonitorEntry, type TaskMonitorFailure, type TaskMonitorResult } from '../constants.js';
import { type ClassifiedSeed } from './classify.js';
export interface TaskMonitorStoreOptions {
    home: string;
    enabled?: () => boolean;
    now?: () => number;
    cwdOf?: (sessionId: string) => unknown;
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
    /** 失败的文件操作不是产出，也不覆盖此前成功的产出。 */
    record(sessionId: string, seeds: readonly ClassifiedSeed[], status: "ok" | "failed"): Promise<void>;
    /** 记住本会话最近一次变更记录的坐标：面板那行 +N −M 据此打开官方审查 tab。 */
    noteChange(sessionId: string, seq: number, turn: number): void;
    snapshot(sessionId: unknown): Promise<TaskMonitorResult>;
    addSource(sessionId: unknown, kind: unknown, value: unknown): Promise<AddSourceResult>;
    removeSource(sessionId: unknown, id: unknown): Promise<RemoveSourceResult>;
    flush: (sessionId: string) => Promise<void>;
    dispose(): Promise<void>;
};
export type TaskMonitorStore = ReturnType<typeof createTaskMonitorStore>;
//# sourceMappingURL=store.d.ts.map