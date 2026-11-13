export declare const MOBILE_LOOP_TOOL_NAME = "mobile_loop";
export declare const MOBILE_LOOP_PURPOSE = "mobile.action";
export declare const MOBILE_LOOP_MAX_STEPS = 5;
/** 点一下屏幕的注入点：宿主可覆盖（面板驱动），默认走 mobilecli CLI。 */
type TapHandler = (options: {
    deviceId: string;
    x: number;
    y: number;
    signal?: AbortSignal;
}) => Promise<unknown>;
export declare function isJudgmentUsable(judge: any, purpose?: string): boolean;
export declare function createMobileLoopRequest(goal: unknown, elements: any[]): any;
export declare function runMobileLoop({ client, judge, purpose, device, goal, maxSteps, performTap, wait, signal, }: {
    client: any;
    judge: any;
    purpose?: string;
    device?: string;
    goal: string;
    maxSteps?: number;
    performTap?: TapHandler | null;
    wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
    signal?: AbortSignal;
}): Promise<any>;
export {};
//# sourceMappingURL=mobile-loop.d.ts.map