/** Writable skill roots, per scope. `id` is what the UI shows as the 区域 tag. */
export declare function writableRoots({ dshHome, agentsHome, projectRoot }: any): {
    id: string;
    scope: string;
    dir: string;
}[];
/** Names become directory names: reject anything that could escape the root. */
export declare function validateSkillName(name: any): any;
/** `SKILL.md` content: frontmatter (name/description) plus the body. */
export declare function renderSkillMarkdown({ name, description, body }: any): string;
/** Create `<root>/<name>/SKILL.md`; refuses to overwrite an existing skill. */
export declare function createSkill({ dir, name, description, body }: any): Promise<{
    ok: boolean;
    reason: any;
    name?: undefined;
    path?: undefined;
} | {
    ok: boolean;
    name: any;
    path: string;
    reason?: undefined;
}>;
/** Overwrite an existing skill's SKILL.md (same directory, same name unless renamed). */
export declare function updateSkill({ dir, name, description, body }: any): Promise<{
    ok: boolean;
    reason: any;
    name?: undefined;
    path?: undefined;
} | {
    ok: boolean;
    name: any;
    path: string;
    reason?: undefined;
}>;
/**
 * Rename a skill: move `<dir>/<from>` to `<dir>/<to>` and rewrite the frontmatter
 * name to match. Refuses when the target exists; keeps a backup of the original.
 */
export declare function renameSkill({ dir, from, to, description, body }: any): Promise<{
    ok: boolean;
    reason: any;
    name?: undefined;
    path?: undefined;
} | {
    ok: boolean;
    name: any;
    path: string;
    reason?: undefined;
} | {
    ok: boolean;
    name: any;
    path: string;
    backup: string;
}>;
/** Remove a skill directory (with a backup first). */
export declare function deleteSkill({ dir, name }: any): Promise<{
    ok: boolean;
    reason: any;
    name?: undefined;
    backup?: undefined;
} | {
    ok: boolean;
    name: any;
    backup: string;
    reason?: undefined;
}>;
/**
 * Everything after the frontmatter block — with the separator newlines consumed.
 *
 * Kept identical to `bodyOf` in `discover.js` **on purpose**: two copies of this regex already
 * drifted once, and the copy that kept the blank line made the editor open with an empty first
 * line. Both now consume the `---`-to-text separator and nothing else, so indentation is
 * preserved. (`discover.bodyOf` adds the 4 KB cap for the projection; this one does not.)
 */
export declare function stripFrontmatter(markdown: any): string;
//# sourceMappingURL=write.d.ts.map