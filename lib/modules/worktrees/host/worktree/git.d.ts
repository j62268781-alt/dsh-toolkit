import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox';
interface GitOptions {
    allowedCodes?: number[];
    allowStderr?: {
        code: number;
        text: string;
    };
    stdin?: 'ignore' | {
        readonly data: string;
    };
}
interface PreparedRefWrite {
    commands: string;
    verify(): Promise<void>;
}
export declare function makeWorktreeGit(ctx: any, policy: SandboxPolicy, signal: AbortSignal): Promise<(cwd: string, args: string[], { allowedCodes, allowStderr, stdin, prepared }?: GitOptions & {
    prepared?: PreparedRefWrite;
}) => Promise<{
    text: string;
    code: number;
}>>;
export {};
