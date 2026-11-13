export declare const TOKEN_TTL_MS: number;
export declare const ROUTES: {
    stream: string;
    screenshot: string;
    grant: string;
    devices: string;
    switchDevice: string;
    control: string;
    deviceAction: string;
    status: string;
    panelOpen: string;
    panelOpenAck: string;
};
export type TrustedAuthority = {
    host: string;
    port: number | null;
    scheme: string | null;
};
export declare function stateRoot(): string;
/** Reuse a per-DSH_HOME signing key; controller generations revoke capabilities on reload. */
export declare function prepareStreamAccessKey(): Buffer;
/** Only actual IP literals qualify; a hostname beginning with 127. is not loopback. */
export declare function isLoopbackRemoteAddress(address: any): boolean;
/** host permits any port, host:port pins it, and http(s)://host:port also pins Origin's scheme. */
export declare function parseTrustedAuthority(entry: unknown): TrustedAuthority | null;
/** Host and Origin can reject a loopback peer, but can never authorize a remote peer. */
export declare function checkTransportFence(req: any, trusted?: TrustedAuthority[]): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** Browser POSTs must be same-origin; requests without Origin still need the DSH guard and fence. */
export declare function isSameOriginRequest(req: any): boolean;
/** Capabilities are signed for one device and one selection generation. */
export declare class StreamAccessController {
    #private;
    key: Buffer;
    ttlMs: number;
    constructor({ key, ttlMs }: {
        key: Buffer;
        ttlMs?: number;
    });
    revoke(): void;
    mint(deviceId: string): string;
    verify(token: unknown): {
        ok: false;
        reason: string;
    } | {
        ok: true;
        deviceId: string;
        expiresAt: number;
    };
}
//# sourceMappingURL=access.d.ts.map