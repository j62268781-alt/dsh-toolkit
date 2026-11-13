export declare const IMPORT_SOURCES: ({
    id: string;
    label: string;
    project: string[];
    global: string[];
    keys: string[];
    supported?: undefined;
    shape?: undefined;
} | {
    id: string;
    label: string;
    project: string[];
    global: string[];
    keys: any[];
    supported: boolean;
    shape?: undefined;
} | {
    id: string;
    label: string;
    project: string[];
    global: string[];
    keys: string[];
    shape: string;
    supported?: undefined;
})[];
/** Absolute path for a source entry: `~/…` is user-level, otherwise project-relative. */
export declare function importFilePath(relative: any, project: any): string;
/** JSON.parse that tolerates the comments/trailing commas editors allow. */
export declare function parseJsonLoose(text: any): any;
/** HTTP headers record -> the panel's KEY=VALUE lines. */
export declare function headerLines(headers: any): string;
/** Env record -> the panel's KEY=VALUE lines. */
export declare function envLines(env: any): string;
/** One tool's entry -> the panel's server shape, or null when unsupported. */
export declare function adaptImportedEntry(name: any, spec: any, shape: any): any;
/**
 * Scan one tool's project files. Returns what exists, what parsed, what the
 * panel would import (as project-scoped panel entries) and why anything failed.
 */
//# sourceMappingURL=sources.d.ts.map