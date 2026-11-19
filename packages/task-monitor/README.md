# dsh-toolkit-task-monitor

会话右栏的「任务监控」面板，复刻 Qoder 任务监控的五个分区：

- **Skill 与 MCP**：任务用过的 Skill、MCP 工具与其他运行时能力；
- **产出**：write / edit / present 等工具产生的文件；
- **网页查阅**：web_fetch / web_search 与浏览器类 MCP 打开的网页；
- **来源**：read 引用的文件与链接，支持手动添加文件 / 链接、hover 移除；
- **知识**：知识库检索与读取记录。

host 侧只读订阅 `tools/post-execute` / `tools/result`，按会话聚合落盘
（`$DSH_HOME/toolkit-task-monitor/sessions/`），不执行任何 git / 网络命令；
环境条的分支与脏标记复用 `dsh-toolkit-git` 的快照路由。client 侧在右栏
注册 tab 类型与 keyed body，composer 右座提供触发按钮；文件行点击走宿主
原生文件预览，网页行点击开右栏 browser tab。

配置项：`enabled`（默认 true）。关掉后停止记录，路由返回 4105。