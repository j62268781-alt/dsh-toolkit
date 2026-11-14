/**
 * 把 mobilecli 自带的 skill 注册给模型。
 *
 * ── 为什么不自己写一份，而是打包上游的 ──────────────────────────────────
 * mobilecli 仓库里已经有一份写得很好的 playbook（`skills/mobilecli/SKILL.md`
 * + `reference.md`），内容是命令的完整用法、平台差异、以及一串踩坑记录
 * （ref 会被界面变化作废、写文本前必须先点输入框获得焦点、多设备时必须显式
 * 指定 id、远端设备要 release 否则持续计费）。这些是上游工具作者的一手经验，
 * 重新写一份只会更差，而且会随 mobilecli 版本漂移。
 *
 * 所以本包把这两份文件**原样打包**，在加载时读进来注册。上游更新时，
 * 把 `skills/mobilecli/*.md` 重新同步一次即可。
 *
 * ── 为什么剥掉 frontmatter ─────────────────────────────────────────────
 * SKILL.md 开头的 YAML frontmatter（name / description / allowed-tools）是
 * Claude Code 的技能约定。DSH 的 `ctx.skills.register()` 要的是**结构化字段**
 * （name / description / whenToUse / content），frontmatter 混在 content 里
 * 会被当成正文喂给模型，既浪费 token 又可能让模型误以为那是文档结构。
 * 所以这里解析出来，frontmatter 的 name/description 用作注册字段。
 *
 * ── 为什么防御性注册 ───────────────────────────────────────────────────
 * 没有 skills 服务的 profile（headless）不该因为本插件而加载失败。
 * 与 dsh-android 的做法一致：`ctx.inject(['skills'])` 拿不到就静默跳过，
 * 插件其余部分照常工作。
 *
 * @module dsh-toolkit-mobile/lib/skills
 */
/**
 * 解析 Markdown 的 YAML frontmatter。
 *
 * 只处理这个场景需要的标量与块状字符串，不引入 YAML 解析依赖——
 * 本插件承诺零运行时依赖。frontmatter 里出现的字段是可预期的三个
 * （name / description / allowed-tools），用一个够用的解析器即可。
 *
 * 支持：
 *   key: value
 *   key: >-     （折叠块，后续缩进行拼成一行）
 *   key: |      （字面块，保留换行）
 *
 * @param {string} text
 * @returns {{attributes: Record<string, string>, body: string}}
 */
export declare function parseFrontmatter(text: string): {
    attributes: Record<string, string>;
    body: string;
};
/**
 * 读取并解析打包的 skill。
 *
 * @returns {{name: string, description: string, whenToUse: string, content: string}|null}
 *   null 表示文件缺失或不可读（不该让插件加载失败）
 */
export declare function loadBundledSkill(): {
    name: string;
    description: string;
    whenToUse: string;
    content: string;
};
/**
 * 注册打包的 skill。
 *
 * @param {object} ctx 插件上下文
 * @param {Function} [log]
 * @returns {() => void} disposer（无 skills 服务时是空操作）
 */
export declare function registerSkills(ctx: any, log?: (level: string, message: string) => void): () => void;
//# sourceMappingURL=skills.d.ts.map