/** The shipped MCP client every managed row instantiates. */
export declare const MCP_MODULE = "@deepseek-ai/dsh-mcp-client";
/** Find a row by id, whether it sits at the top level or inside an `insert:` list. */
export declare function locateRow(document: any, rawEntryId: any): {
    container: import("yaml").YAMLSeq<unknown>;
    index: number;
    item: import("yaml").YAMLMap<unknown, unknown>;
    place: string;
};
/** Drop one row, and the now-empty `insert:` directive that carried it. */
export declare function removeRow(document: any, entryId: any): boolean;
/** Set or clear one field inside a row's `config`, creating the map when absent. */
export declare function setRowConfigField(document: any, entryId: any, field: any, value: any): boolean;
/**
 * The row's `config.scope`, or null when the row does not exist.
 *
 * An absent scope means `global` (that is what the plugin's own model assumes), so callers
 * can compare against {@link GLOBAL_SCOPE} without special-casing the empty string.
 */
export declare function rowScopeOf(document: any, entryId: any): string;
/** Enable/disable a whole row (the Loader's own `disabled` flag). */
export declare function setRowDisabled(document: any, entryId: any, disabled: any): boolean;
/**
 * Append a fresh mcp-client row to the patch's first `insert:` instruction.
 *
 * `disabled` is written for a **project-scoped** row: the Loader instantiates every row it
 * is not told to skip, and a project row must not be connected by the Loader — this plugin
 * mounts it into the agent whose working directory the row's `scope` covers. Leaving it
 * enabled would connect the same server twice (two clients, two tool generations, one
 * namespace). A disabled row still appears in `loader.entries()` with its config intact
 * (`disabled` is an entry getter, not a filter on the store), which is exactly what the
 * mount path needs to read.
 */
export declare function insertRow(document: any, id: any, config: any, options?: any): boolean;
//# sourceMappingURL=rows.d.ts.map