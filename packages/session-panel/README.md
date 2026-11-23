# dsh-toolkit-session-panel

在支持官方会话面板的 DSH 版本里，为当前会话补充四个只读分区。有记录时才显示对应分区：

- **技能与 MCP**：会话用过的技能和归入能力类的 MCP 调用，不是已安装能力清单；
- **网页查阅**：web_fetch / web_search 与浏览器类 MCP 打开的网页；
- **产出**：write / edit / present 等工具产生的文件；
- **来源**：会话引用的文件与链接。

Host 按会话聚合记录；为兼容旧版历史，仍保存到 `$DSH_HOME/toolkit-task-monitor/sessions/`。文件行使用宿主原生预览；「网页查阅」和「来源」的链接优先使用官方内置浏览器，悬停或键盘聚焦行末时可从「更多操作」在外部浏览器打开。未启用内置浏览器时，点击链接直接打开新标签。侧栏布局、折叠和滚动由官方会话面板负责。

DSH 0.2.3-alpha.2 的 Web profile 默认不开启内置浏览器。需要时可在目标 Web profile 启用官方 `ui-sidebar-browser`；Web 内嵌受目标站点的 iframe 策略限制，打不开的站点可用外部浏览器。

配置项：`enabled`（默认 true）。关掉后停止记录，路由返回 4105。
