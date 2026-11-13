type ScreenSize = {
    width: number;
    height: number;
};
/** One deadline covers both transports; timing out closes actual IO before returning no scale hint. */
export declare function createScreenSizeLookup({ client, rpc, signal, ttlMs, timeoutMs }: {
    client: any;
    rpc: any;
    signal?: AbortSignal;
    ttlMs?: number;
    timeoutMs?: number;
}): (deviceId: string) => Promise<ScreenSize | null>;
export {};
//# sourceMappingURL=screen-size.d.ts.map