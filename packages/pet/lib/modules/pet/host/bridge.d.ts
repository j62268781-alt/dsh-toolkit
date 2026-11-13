import { type IncomingMessage, type ServerResponse } from 'node:http';
export declare function attachEvents(req: IncomingMessage, res: ServerResponse, listeners: Set<() => void>, snapshot: () => any): () => void;
export declare function parseAction(req: IncomingMessage): Promise<any>;
export interface HelperBridge {
    url: string;
    token: string;
    publish(): void;
    dispose(): Promise<void>;
}
/** Private loopback server: capability never enters the page or public API. */
export declare function createHelperBridge(snapshot: () => any, action: (value: any) => Promise<any>): Promise<HelperBridge>;
//# sourceMappingURL=bridge.d.ts.map