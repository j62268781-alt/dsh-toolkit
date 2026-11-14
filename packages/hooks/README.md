# 钩子管理

在任务的关键节点（会话开始、提交提示词、工具调用前后、回合结束）运行你自己的命令，并在设置里查看当前生效的配置。

包名：`dsh-toolkit-hooks`。可由 dsh-toolkit 聚合安装，也可单独作为 DSH bundle 安装。设置入口：**设置 → 钩子**。

## 配置文件

三个来源按「用户级 → 项目级 → 本机」合并（项目级跟着会话的工作目录走，切换仓库就读新仓库的配置）：

| 来源 | 路径 |
| --- | --- |
| 用户级 | `$DSH_HOME/hooks.json`（可用配置项 `userFile` 改成别的文件） |
| 项目级 | `<项目>/.dsh/hooks.json` |
| 本机 | `<项目>/.dsh/hooks.local.json` |

格式与 Claude Code 的 hooks 兼容，顶层可以套一层 `hooks` 键，也可以直接写事件表：

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "bash", "hooks": [{ "type": "command", "command": "echo hello" }] }
    ]
  }
}
```

- `matcher` 按 `|` 之外的逗号分隔正则匹配，不区分大小写；空串或 `*` 表示全部。
- `timeout` 单位是秒（`timeoutMs` 是毫秒），缺省 60 秒，上限 600 秒。
- 命令里可用 `${DSH_HOME}` 与 `${project}` 占位符；相对路径按项目目录解析。
- 改完文件不用重启：每次事件都会按 mtime 重读，面板也能立刻刷新看到。

## 已接线的五个事件

| 事件 | 触发点 | matcher 的对象 | 能否改变结果 |
| --- | --- | --- | --- |
| `SessionStart` | 会话创建 | 启动来源（如 `startup`） | 注入上下文 |
| `UserPromptSubmit` | 每轮提交提示词前 | — | 拒绝本轮 / 追加上下文 |
| `PreToolUse` | 工具执行前 | 工具名 | 拒绝、询问、放行 |
| `PostToolUse` | 工具执行后 | 工具名 | 拦截并把理由回给模型 / 追加上下文 |
| `Stop` | 回合即将结束 | — | 要求模型再走一步（连续 3 次后强制放行） |

`SessionEnd`、`SubagentStart/Stop`、`PreCompact`、`Notification` 等事件名会被解析、在面板上显示，但标为「暂不支持」——不会静默假装生效。

## 决策怎么读

子进程退出码与 stdout 决定结果：

- 退出码 `2`：拒绝（`stderr` 当理由）；
- 退出码 `0` 且 stdout 是 JSON：`{"decision":"allow|deny|ask","reason":"…","additionalContext":"…"}`，或 Claude Code 的 `hookSpecificOutput.permissionDecision` 形态；
- 其它退出码、超时、起不来：只记进历史，不影响这一轮。

## 面板能看到什么

- 三个配置文件的路径与状态（正常 / 不存在 / 格式错误 / 读不出来），点路径可复制；
- 按事件分组的钩子列表：来源、matcher、命令、超时，以及每条的执行历史；
- 配置诊断（未知事件、缺 `hooks` 数组、非法正则、不支持的 `type` 等）挂到具体条目上；
- 「试跑」：用一份合成载荷跑一次，只写历史、不参与决策。

面板是只读的：改配置请编辑上面列出的文件。

## 已知限制

- 只执行 `type: "command"`；`http`、`prompt`、`agent` 会标为不支持。
- 命令输出按 UTF-8 解码。Windows 上 `cmd` 内建命令在管道里按 OEM 代码页输出，**命令行里别写中文**——把中文放进 UTF-8 脚本文件里再调用。
- 模块总开关（`enabled`）关掉后配置照旧展示，但一条都不会执行。

源码集中在仓库的 src/modules/hooks；公共 Host/Client 工具集中在 src/host 与 src/client。请在仓库根目录运行 pnpm build，不要编辑本包的 lib 构建产物。
