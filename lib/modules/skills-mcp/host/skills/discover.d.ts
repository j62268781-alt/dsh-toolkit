/** The scan roots for one or more project roots plus the user-level roots. */
export declare function skillRootsFor({ projectRoots, dshHome, agentsHome }: any): {
    path: string;
    source: string;
    scope: any;
}[];
/** `name`/`description` from a SKILL.md frontmatter block (best effort). */
export declare function parseFrontmatter(markdown: any): any;
/**
 * The markdown body without the frontmatter block, capped for the projection.
 *
 * This is the **exact inverse of `renderSkillMarkdown`**, which writes
 * `---\n<front>\n---\n\n<body>` and strips leading newlines from the body. So the blank line
 * between the closing `---` and the text is **formatting, not content**, and reading it back as
 * part of the body made the editor open with an empty first line (「正文多了一行，然后才到正文」);
 * saving then persisted that blank line, so the file grew on every round-trip.
 *
 * Consuming exactly that separator is what makes read the inverse of write, and it is why this
 * cannot simply use `\s*` — that also eats a body's leading **indentation**, which the writer
 * preserves (a body starting with an indented block is legitimate, e.g. inside a code fence).
 */
export declare function bodyOf(markdown: any): string;
/** Scan one root; a missing root simply yields nothing. */
export declare function scanSkillRoot(root: any): Promise<{
    name: any;
    description: any;
    path: any;
    source: any;
    scope: any;
}[]>;
/** Scan every root; duplicates keep the first (more specific) one. */
export declare function discoverSkills(options: any): Promise<{
    name: any;
    description: any;
    path: any;
    source: any;
    scope: any;
}[]>;
//# sourceMappingURL=discover.d.ts.map