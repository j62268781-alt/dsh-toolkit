/** OAuth state, transport patch, commands and refresh lifecycle for one plugin scope. */
export declare function createOAuthController(ctx: any): {
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
//# sourceMappingURL=controller.d.ts.map