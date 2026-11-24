import s from '@deepseek-ai/schemastery';
/**
 * Git 偏好模块配置。
 *
 * 三项都是「agent 怎么用 git」的偏好，不是 DSH 自己执行 git 的开关——DSH 没有 Git UI，
 * 真正跑 `git push` 的是 agent 的 shell 工具。所以这里只存值，生效靠 `prompt.ts` 把它
 * 拼进系统提示词（详见 `index.ts`）。
 */
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    /** 新建分支时预填的前缀；留空表示不加前缀。 */
    branchPrefix: s<string, string, "volatile-defined">;
    /** 推送已存在的远端分支时使用 `--force-with-lease`。 */
    alwaysForcePush: s<boolean, boolean, "volatile-defined">;
    /** 追加到提交说明生成指令里的用户偏好（自由文本，允许换行）。 */
    commitInstructions: s<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** 新建分支时预填的前缀；留空表示不加前缀。 */
    branchPrefix: s<string, string, "volatile-defined">;
    /** 推送已存在的远端分支时使用 `--force-with-lease`。 */
    alwaysForcePush: s<boolean, boolean, "volatile-defined">;
    /** 追加到提交说明生成指令里的用户偏好（自由文本，允许换行）。 */
    commitInstructions: s<string, string, "volatile-defined">;
}>>, "plain">;
export interface GitSettings {
    branchPrefix: string;
    alwaysForcePush: boolean;
    commitInstructions: string;
}
/**
 * 读配置并归一化。
 *
 * 手改 `cordis.patch.yml` 完全可能写出非法前缀，而这里跑在插件启动路径上：**不能抛错**
 * （一个坏字段会让整个模块加载失败），只能退回到「空前缀 / 默认值」。
 */
export declare function readSettings(config?: any): GitSettings;
