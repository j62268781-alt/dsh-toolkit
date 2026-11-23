export interface WorktreeConfig {
    directory: string;
    namePrefix: string;
}
export interface WorktreeConfigUpdate extends WorktreeConfig {
    expected: WorktreeConfig;
}
type RawConfig = Record<string, unknown>;
interface Entry {
    options: {
        id: string;
        name?: string;
    };
    fiber?: {
        state: number;
        effectiveConfig: unknown;
        resolveConfig(config: unknown): unknown;
    };
}
export interface WorktreeConfigEditor {
    entries(): Entry[];
    edit(entry: Entry, change: (current: RawConfig, inherited: RawConfig) => RawConfig): Promise<void>;
}
export declare function isWorktreeConfigUpdate(value: unknown): value is WorktreeConfigUpdate;
export declare function readWorktreeConfig(editor: WorktreeConfigEditor | undefined): WorktreeConfig;
export declare function updateWorktreeConfig(service: WorktreeConfigEditor | undefined, update: WorktreeConfigUpdate): Promise<WorktreeConfig>;
export {};
