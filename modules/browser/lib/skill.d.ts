/**
 * 内置 skill：把随包发布的 `skills/agent-browser/`（SKILL.md + references/）注册成**运行时 skill**。
 *
 * 为什么内置而不是让用户自己装：这份 skill 是**与安装的 CLI 版本对齐**的核心命令集
 * （官方 `agent-browser skills get core --full` 是全量参考，直接塞进目录太重）。
 * 装插件即得。
 *
 * 三条纪律：
 * - **`ctx.skills` 是可选服务**：不在就跳过并记日志，绝不让整个插件起不来。
 * - **不改原文**：SKILL.md 逐字使用（它是同步 CLI 版本的产物），插件相关的补充
 *   放在注册时**追加**的一段里，避免两份真相各自漂移。
 * - `resourceBase` 指向 references 目录，模型可以按需读那 5 份深入参考。
 */
/** `lib/skill.js` → `<包根>/skills/agent-browser`。 */
export declare const SKILL_ROOT: string;
export interface BundledSkill {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly content: string;
    readonly resourceBase: {
        readonly kind: 'directory';
        readonly path: string;
    };
}
/**
 * 解析 SKILL.md 的 frontmatter。只支持**单行** `key: value`——我们自己的 SKILL.md
 * 就是这么写的；遇到不认识的形状不猜，直接报错（宁可显式失败）。
 */
export declare function parseSkillFile(text: string): {
    readonly fields: Record<string, string>;
    readonly body: string;
};
/** 读随包发布的 SKILL.md。文件缺失 = 打包出错，明确抛错。 */
export declare function loadBundledSkill(): BundledSkill;
/** 注册时追加的插件补充：skill 原文不动，插件的存在与工具名在这里说。 */
export declare function pluginNote(options: {
    readonly tools: boolean;
    readonly decision: boolean;
}): string;
//# sourceMappingURL=skill.d.ts.map