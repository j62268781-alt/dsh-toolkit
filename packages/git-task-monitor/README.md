# Git 约定与任务监控

`dsh-toolkit-git-task-monitor` 是一个 DSH bundle，一次安装、保留两个独立的 Cordis 条目：

| 条目 ID | 功能 |
| --- | --- |
| `dsh-toolkit-git` | Git 设置、输入框分支操作与 `git_*` 工具 |
| `dsh-toolkit-task-monitor` | 会话右栏的任务监控与历史记录 |

两个组件的开关、配置字段、工具名和路由不变。任务监控继续读取同一 `$DSH_HOME/toolkit-task-monitor/sessions/` 下的记录，不需要导入或搬移历史。

## 安装或切换

从源码安装时，先在仓库根目录运行 `pnpm build`。桌面应用使用插件管理安装已构建的 `packages/git-task-monitor` 目录。对于由 CLI 管理的 profile（例如 `web`），可使用：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-toolkit/packages/git-task-monitor
```

**每个 ID 在同一个 profile 中只能有一个声明来源。** 单独关掉组件开关不等于移除其 bundle 的插入声明；不要同时启用组合包与旧的 Git 独立包、任务监控独立包或聚合包。没有这些来源的新 profile 可直接安装。

1. 备份目标 profile 的清单、锁文件和配置补丁；保留原来的 `$DSH_HOME` 和其中的任务监控目录。不要重置组件配置或清除数据。
2. **先停用旧来源，再启用新来源。** 从独立包切换时，将已安装的 `dsh-toolkit-git` 和／或 `dsh-toolkit-task-monitor` 从该 profile 的启用 bundle 中移除；从聚合包切换时，停用整个 `dsh-toolkit` 聚合包。后者也会停用聚合包提供的其他功能；如需保留它们，可单独安装所需的非冲突 bundle，或继续使用聚合包，二选一。若有手写的同 ID `insert`，也须先移除这些重复声明。
3. 保留以这两个 `id` 为目标的 profile 覆盖，包括原有 `config` 和 `disabled` 值。若覆盖还写了旧 npm 包名的 `name:` 断言，只去掉这两个覆盖的 `name:` 行，保留 `id` 和其余字段。`name` 断言的是加载路径；组合包的实现从包内文件加载。不要删除插入条目必需的 `name` 字段。组合包不会替你改写已安装的 profile。
4. 安装并启用组合包，重启该 DSH 实例，再刷新页面。确认组件列表里两个 ID 各出现一次、原设置仍在，并打开旧会话检查任务监控记录。

回退时顺序相反：先停用组合包，再恢复原来的非冲突来源和需要的 profile 覆盖，重启后刷新；无需迁移历史。若继续使用仅按 `id` 匹配的覆盖，不必恢复旧 `name:` 断言。
