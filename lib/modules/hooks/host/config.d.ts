import s from '@deepseek-ai/schemastery';
/**
 * Hooks 模块配置。
 *
 * 真正的钩子内容在 `hooks.json` 里（那是用户要手写、要和 Claude Code 共用的文件），
 * 这里只放「文件在哪、跑不跑、超时多少」这类宿主侧参数。
 */
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    enabled: s<boolean, boolean, "defined">;
    /** 用户级钩子文件；留空表示 `$DSH_HOME/hooks.json`。相对路径按项目目录解析。 */
    userFile: s<string, string, "defined">;
    /** 项目级 `<项目>/.dsh/hooks.json` 与 `hooks.local.json` 是否参与合并。 */
    includeProject: s<boolean, boolean, "defined">;
    /** 项目目录；留空表示宿主进程的启动目录。 */
    projectDir: s<string, string, "defined">;
    /** 单条 hook 未写 `timeout` 时的超时（毫秒）。 */
    defaultTimeoutMs: s<number, number, "defined">;
    /** 「最近执行」保留多少条。 */
    maxHistory: s<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: s<boolean, boolean, "defined">;
    /** 用户级钩子文件；留空表示 `$DSH_HOME/hooks.json`。相对路径按项目目录解析。 */
    userFile: s<string, string, "defined">;
    /** 项目级 `<项目>/.dsh/hooks.json` 与 `hooks.local.json` 是否参与合并。 */
    includeProject: s<boolean, boolean, "defined">;
    /** 项目目录；留空表示宿主进程的启动目录。 */
    projectDir: s<string, string, "defined">;
    /** 单条 hook 未写 `timeout` 时的超时（毫秒）。 */
    defaultTimeoutMs: s<number, number, "defined">;
    /** 「最近执行」保留多少条。 */
    maxHistory: s<number, number, "defined">;
}>>, "plain">;
export interface HooksSettings {
    enabled: boolean;
    userFile: string;
    includeProject: boolean;
    projectDir: string;
    defaultTimeoutMs: number;
    maxHistory: number;
}
export declare function readSettings(config?: any): HooksSettings;
//# sourceMappingURL=config.d.ts.map