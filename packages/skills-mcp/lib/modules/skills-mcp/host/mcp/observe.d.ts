/** Observe live MCP connections without blocking the runtime read path. */
export declare function createServerObserver(ctx: any, { agents: readAgents, servers: readServers }: any): {
    oauth: {
        statusCache: Map<any, any>;
        invalidateStatus: (serverName: any) => void;
        readonly ready: {
            ready: boolean;
            reason: string;
            detail: string;
            sdkVersion: string;
        };
        readonly callbackReady: boolean;
        readonly callbackPath: string;
        redirectUri: () => string;
        refreshStatus: (serverName: any, url: any) => void;
        installSweep: () => void;
        registerRoutes: ({ invalidateServerCaches, reconnectServer }: any) => void;
    };
    recordMount: (serverName: any, fiber: any) => void;
    computeServerStatus: ({ rows, entries, toolCounts }: any) => {
        serverName: any;
        tier: any;
        scope: any;
        status: "pending" | "unknown" | "failed" | "disabled" | "connected" | "retrying" | "gave-up" | "unmounted" | "needs-auth";
        toolCount: any;
        elapsedMs: number;
        budgetMs: number;
        remainingSeconds: number;
        detail: string;
    }[];
    invalidateServerCaches: (serverName: any) => void;
    readProbeState: () => {
        installed: boolean;
        reason: string;
        results: {
            serverName: any;
            state: string;
            detail: string;
        }[];
    };
};
//# sourceMappingURL=observe.d.ts.map