export interface CachedTool {
    name: string;
    rawName?: string;
    description: string;
    parameters: any;
}
export interface CatalogSnapshot {
    tools: CachedTool[];
    capturedAt: number;
    ttlMs: number | null;
    cacheScope: 'public' | 'private' | null;
}
export declare function cacheFile(): string;
export declare function catalogFresh(entry: CatalogSnapshot, manual: boolean, now: number): boolean;
export declare function createToolCache({ file, warn }?: {
    file?: string;
    warn?: (_message: string) => void;
}): {
    load(): Promise<void>;
    get(key: string, fingerprint: string, identity: "anonymous" | null, manual: boolean, now: number): CatalogSnapshot | null;
    put(key: string, fingerprint: string, identity: "anonymous" | null, entry: CatalogSnapshot, manual: boolean): any;
    drop(key: string): Promise<void>;
    flush: () => Promise<void>;
};
