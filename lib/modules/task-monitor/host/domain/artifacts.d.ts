import type { TaskMonitorEntry } from '../constants.js';
import { type ClassifiedSeed } from './classify.js';
export declare function absoluteArtifact(seed: ClassifiedSeed, cwd: unknown): ClassifiedSeed;
export declare function workspaceArtifacts(summary: any): ClassifiedSeed[];
/** Live disk metadata belongs in the snapshot, not the persisted event ledger. */
export declare function withArtifactMetadata(entry: TaskMonitorEntry, cwd: unknown): Promise<TaskMonitorEntry>;
