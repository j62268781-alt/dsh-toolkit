import s from '@deepseek-ai/schemastery';
import { DEFAULT_ALWAYS_FORCE_PUSH, DEFAULT_BRANCH_PREFIX, DEFAULT_COMMIT_INSTRUCTIONS, isBranchPrefix, normalizeBranchPrefix, normalizeCommitInstructions, } from './constants.js';
/**
 * Git 偏好模块配置。
 *
 * 三项都是「agent 怎么用 git」的偏好，不是 DSH 自己执行 git 的开关——DSH 没有 Git UI，
 * 真正跑 `git push` 的是 agent 的 shell 工具。所以这里只存值，生效靠 `prompt.ts` 把它
 * 拼进系统提示词（详见 `index.ts`）。
 */
export const Config = s.object({
    /** 新建分支时预填的前缀；留空表示不加前缀。 */
    branchPrefix: s.string().default(DEFAULT_BRANCH_PREFIX),
    /** 推送已存在的远端分支时使用 `--force-with-lease`。 */
    alwaysForcePush: s.boolean().default(DEFAULT_ALWAYS_FORCE_PUSH),
    /** 追加到提交说明生成指令里的用户偏好（自由文本，允许换行）。 */
    commitInstructions: s.string().default(DEFAULT_COMMIT_INSTRUCTIONS),
});
/** 配置字段可能是 `{ get() }`（宿主把 volatile 字段做成活动引用），取值时要兼容两种形状。 */
function readField(config, key) {
    const field = config?.[key];
    try {
        return typeof field?.get === 'function' ? field.get() : field;
    }
    catch {
        return undefined;
    }
}
/**
 * 读配置并归一化。
 *
 * 手改 `cordis.patch.yml` 完全可能写出非法前缀，而这里跑在插件启动路径上：**不能抛错**
 * （一个坏字段会让整个模块加载失败），只能退回到「空前缀 / 默认值」。
 */
export function readSettings(config = {}) {
    const rawPrefix = readField(config, 'branchPrefix');
    const prefix = typeof rawPrefix === 'string' ? normalizeBranchPrefix(rawPrefix) : DEFAULT_BRANCH_PREFIX;
    const force = readField(config, 'alwaysForcePush');
    const rawInstructions = readField(config, 'commitInstructions');
    return {
        branchPrefix: isBranchPrefix(prefix) ? prefix : DEFAULT_BRANCH_PREFIX,
        alwaysForcePush: typeof force === 'boolean' ? force : DEFAULT_ALWAYS_FORCE_PUSH,
        commitInstructions: typeof rawInstructions === 'string'
            ? normalizeCommitInstructions(rawInstructions)
            : DEFAULT_COMMIT_INSTRUCTIONS,
    };
}
//# sourceMappingURL=config.js.map