import { type ClassifiedSeed } from './classify.js';
/** Collect sources from a consumed user input and the optional recall directly after it. */
export declare function collectInputSources(message: unknown, recall?: unknown): ClassifiedSeed[];
/** Observe newly consumed input, without reading or replaying session history. */
export declare function observeInputSources(record: (sessionId: string, seeds: ClassifiedSeed[]) => void): (session: unknown, event: unknown) => void;
