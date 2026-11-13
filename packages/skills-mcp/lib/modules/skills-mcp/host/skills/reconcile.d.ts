/** Nearest ancestor holding `.git` — the same project-root rule as the skill provider. */
export declare function projectRootOf(dir: any): string;
/** `~/.agents`, honoured overridable the same way DSH does it. */
export declare function agentsHome(): string;
/**
 * The skills directory one entry writes into.
 *
 * `id` selects **which** of the two roots under a scope: `dsh` or `agents`. It defaults to
 * `dsh`, which is what every entry written before this option existed means.
 *
 * This parameter is not cosmetic. The panel offers all four roots, and DSH's provider reads
 * all four, so an entry recorded without its root would be *moved* by the next reconcile:
 * the file the user just wrote to `~/.agents/skills` would be deleted and rewritten under
 * `~/.dsh/skills` (or vice versa), with no error anywhere.
 */
export declare function scopeRoot(scope: any, id?: string): string;
/** Frontmatter plus body, exactly what the filesystem skill provider parses. */
export declare function renderSkill(skill: any): string;
export declare function readState(): Promise<any>;
/**
 * Diagnostics: every tick records what it observed and what it did, so the
 * running app can be inspected without a console. Remove once the volatile
 * config read path is proven stable.
 */
export declare function reconcileSkills(ctx: any, skills: any): Promise<any>;
//# sourceMappingURL=reconcile.d.ts.map