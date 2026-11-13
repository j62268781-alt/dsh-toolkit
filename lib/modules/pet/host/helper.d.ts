import { type ChildProcess, type SpawnOptions } from 'node:child_process';
import { type ResolveElectronOptions } from './electron.js';
import { type PetSettings } from './config.js';
import type { HelperBridge } from './bridge.js';
/** 与 `spawn` 的三参数重载同形；测试用假实现替换它（见 tests/pet/host.helper.test.mjs）。 */
type Launch = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
/** 客户端只看 `status` 决定画什么；`error` 是给人看的诊断文本，会原样进 /state。 */
export interface HelperState {
    status: 'stopped' | 'starting' | 'running' | 'error';
    available: boolean;
    error?: string | undefined;
}
export interface HelperManagerOptions {
    onChange: () => void;
    bridge: HelperBridge;
    resolve?: (options: ResolveElectronOptions) => Promise<string | undefined>;
    launch?: Launch;
}
export declare class HelperManager {
    onChange: () => void;
    bridge: HelperBridge;
    resolve: (options: ResolveElectronOptions) => Promise<string | undefined>;
    launch: Launch;
    state: HelperState;
    child: ChildProcess | undefined;
    generation: number;
    enabled: boolean;
    disposed: boolean;
    failures: number;
    pending: Promise<void> | undefined;
    config: any;
    restart: ReturnType<typeof setTimeout> | undefined;
    constructor({ onChange, bridge, resolve, launch }: HelperManagerOptions);
    update(patch: Partial<HelperState>): void;
    prepare(config: any, start?: boolean): Promise<void>;
    configure(config: any, settings: PetSettings): Promise<void>;
    start(binary: string | undefined): void;
    retry(config: any): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
}
export {};
//# sourceMappingURL=helper.d.ts.map