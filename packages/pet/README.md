# dsh-toolkit-pet

桌面宠物和屏幕顶部灵动岛，使用独立的 Electron 辅助进程显示原生透明窗口。插件负责运行时准备、启动、状态同步与退出，无需另外运行桌宠应用。

在仓库根目录执行 `pnpm install` 和 `pnpm build`，随后把本目录作为 DSH bundle 安装。聚合包 `dsh-toolkit` 也包含此模块。桌面悬浮和灵动岛默认关闭，可在「设置 → 桌面宠物」中分别开启。

首次开启时会准备 Electron 运行时；也可以先点「准备桌面运行时」。开发或离线使用时，可通过插件配置 `electronPath` 或环境变量 `DSH_TOOLKIT_ELECTRON_PATH` 指定现有 Electron 可执行文件的绝对路径。

模块代码采用 MIT 许可，内置四套原创程序绘制精灵图的资源清单声明为 CC0-1.0。完整配置、架构和限制见仓库的 `docs/pet/README.md`。
