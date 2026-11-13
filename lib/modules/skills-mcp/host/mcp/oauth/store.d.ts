/** Storage format version. */
export declare const STORE_VERSION = 1;
export declare function isValidServerName(name: any): boolean;
export declare function oauthDir(dshHome: any): string;
export declare function oauthFile(dshHome: any, serverName: any): string;
export declare function emptyRecord(serverName: any, url: any): any;
export declare function normalizeRecord(raw: any, serverName: any, url: any): any;
export declare function createOAuthStore({ dshHome, log }?: any): {
    dir: string;
    file: (serverName: any) => string;
    read: (serverName: any, url?: string) => Promise<any>;
    update: (serverName: any, url: any, mutate: any) => Promise<any>;
    write: (serverName: any, record: any) => Promise<any>;
    remove: (serverName: any) => Promise<any>;
};
//# sourceMappingURL=store.d.ts.map