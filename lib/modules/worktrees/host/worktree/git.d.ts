import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox';
interface GitOptions {
    allowedCodes?: number[];
}
export declare function makeWorktreeGit(ctx: any, policy: SandboxPolicy, signal: AbortSignal): Promise<(cwd: string, args: string[], { allowedCodes }?: GitOptions) => Promise<{
    text: string;
    code: number;
}>>;
export {};
