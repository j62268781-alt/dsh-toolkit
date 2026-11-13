export declare const SKILLS_PATH = "/dsh-skills-mcp-manager/skills";
/**
 * Register the skill-write route.
 *
 * `apply` is injected rather than imported so this module stays free of the disk writer and a
 * test can drive the full request/response cycle without touching a real skills root. It receives
 * an **already validated** request and returns the same receipt shape the settings channel
 * produces, so the client handles both identically.
 */
export declare function registerSkillRoute(ctx: any, { schema, apply }: any): void;
//# sourceMappingURL=route.d.ts.map