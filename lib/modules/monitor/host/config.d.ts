import s from '@deepseek-ai/schemastery';
/**
 * 任务监控配置：只有一个总开关。
 *
 * 关掉后 host 不再聚合工具事件（监听器直接放行），面板仍可读历史快照——
 * 「不记录」与「清空」是两件事，这里只做前者。
 */
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    enabled: s<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: s<boolean, boolean, "defined">;
}>>, "plain">;
export interface MonitorSettings {
    enabled: boolean;
}
/** 启动路径上不能抛错：坏字段退回默认值。 */
export declare function readSettings(config?: any): MonitorSettings;
//# sourceMappingURL=config.d.ts.map