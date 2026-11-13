import { execFile as execFileCallback } from 'node:child_process';
export declare const MAX_SOUND_BYTES: number;
declare const runFile: typeof execFileCallback.__promisify__;
/** One playable file the platform actually offers, with the root it must stay under. */
export interface SoundEntry {
    id: string;
    label: string;
    file: string;
    root: string;
}
export interface SoundCatalogEntry {
    id: string;
    label: string;
}
export interface SoundServiceOptions {
    platform?: NodeJS.Platform;
    home?: string;
    env?: NodeJS.ProcessEnv;
    directories?: string[];
    execFile?: typeof runFile;
    tempDirectory?: string;
}
export interface SoundService {
    getCatalog(): Promise<{
        platform: NodeJS.Platform;
        sounds: SoundCatalogEntry[];
    }>;
    readSound(id: unknown): Promise<{
        bytes: Buffer;
        contentType: string;
    }>;
}
export declare function createSoundService({ platform, home, env, directories, execFile, tempDirectory, }?: SoundServiceOptions): SoundService;
export {};
//# sourceMappingURL=sounds.d.ts.map