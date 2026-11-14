/** Offline JSON-safe patch conversion. No profile or runtime state is accessed. */
/** Everything `validate` accepts; rows are plain JSON records after that check. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare const ROOT_IDS: readonly string[];
export declare const MODULE_NAMESPACES: Readonly<{
    boot: "boot";
    theme: "theme";
    archived: "archived";
    browser: "browser";
    judgement: "judgment";
    mobile: "mobile";
    skillsMcp: "skills-mcp";
    notification: "notification";
    pet: "pet";
    hooks: "hooks";
}>;
export interface MigrationResult {
    patches: any[];
    changed: boolean;
    migratedModules: string[];
}
/**
 * Convert insert entries and top-level overrides without inventing insert rows.
 * DSH applyEntryPatches replaces config as a whole: repeated rows for the same id
 * therefore use the final config, not a deep merge of previous override records.
 * New module overrides require the matching module bundle to be installed.
 */
export declare function migratePatch(input: unknown): MigrationResult;
//# sourceMappingURL=migration.d.ts.map