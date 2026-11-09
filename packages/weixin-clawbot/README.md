# dsh-toolkit-weixin-clawbot

把微信变成 **DSH 的一个入口**：在 DeepSeek Harness 的 Web UI 里扫码连接微信 ClawBot（腾讯 iLink 协议），
然后既能在浏览器里看二维码、看连接状态，也能让微信里的消息直接对话到 DSH 的 Agent。

这是为「`dsh web` 由 systemd 托管、没有 tty、终端二维码进 journald 看不到」这个场景写的：
二维码画在浏览器里，不依赖命令行，也不需要额外的常驻侧车进程。

协议与消息模型参考腾讯官方开源实现 [openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT），
DSH 侧的会话/审批接入方式参考 [DeepSeek-harness-weixin](https://github.com/sliverp/DeepSeek-harness-weixin)（MIT）。
本模块是在本仓库里**独立重写**的 JavaScript 实现，不 import、不修改上面两个包。

## 能力

| 能力 | 说明 |
| --- | --- |
| 扫码登录 | 卡片里直接画二维码，支持等待扫码 / 已扫码 / 需数字校验码 / 已过期换码 |
| 凭据管理 | token 只经 `ctx.credentials` 存取，前端只看到掩码账号与节点 host |
| 常驻监听 | 登录后用 `getupdates` 长轮询收消息，游标落盘，重启不重放历史 |
| 双向对话 | 每条微信消息 → 一个持久 DSH Session（按账号 + 用户派生 id）→ Agent 的回复发回微信 |
| 媒体 | 入站图片变成真正的图片块；入站文件落到工作区 `.dsh-weixin/inbox/`；出站图片走 CDN 加密上传 |
| 输入状态 | 处理中给微信发 typing，结束后取消（失败不影响主流程） |
| 审批转发 | Agent 的 `approval/request` 转发到微信，用户回 `/approve` / `/reject` 决定；超时按取消 |
| 斜杠命令 | `/help` `/start` `/status` `/new` `/reset` `/stop` `/cancel` `/approve` `/reject` `/where` `/workspaces` `/sessions` `/use` |
| 会话检索 | `/where` 看当前工作区 + 会话名 + session_id；`/workspaces` 列工作区；`/sessions [序号\|路径\|all]` 列某工作区下的会话 |
| 选择会话 | `/use <序号\|会话id前缀>` 把微信切到某条已有会话（含 GUI 里正开着的，接管不重开）；`/new` 另开一条。绑定落盘，重启继续用同一条；同一时间只驱动一条会话 |
| 首次选择卡 | 还没绑定会话时，普通消息不会被丢掉：先挂起（10 分钟），回一句欢迎语 + 两步选择卡——先选工作区（只显示目录名，最后一项是「不选，用默认工作区」），再选会话（`1` 新建、其余是全部会话标题、`0` 换工作区）；选完自动把挂起的那条补跑。欢迎语按人 24 小时只发一次，`/start` 可随时重发卡片 |
| 访问控制 | 连接成功即开启桥接，且固定 allowlist、只对自己开放：登录时用扫码账号播种白名单，本人第一条消息到达后锁定；其他人发来的消息一律忽略（状态里计 skipped）。面板不再提供开关/策略/测试按钮 |

## 使用

1. `pnpm install && pnpm build`，把本包（或聚合包 `dsh-toolkit`）作为 DSH bundle 安装并重启宿主。
2. 展开左侧栏，鼠标移到侧栏底部的 **微信连接** → **连接微信**。
3. 手机微信扫码并确认；卡片显示 **已连接**，账号是掩码的。
4. 不需要任何额外开关：**桥接在连接成功后就默认开启，并且只对自己开放**。
   - 白名单会用扫码登录的这个微信号播种；本人发第一句话之后锁定，之后其他人的消息一律忽略。
   - 卡片上只显示 账号 / 端点 / 消息监听（含收发计数）；桥接的开关、策略、测试消息等入口都已去掉。
5. 在微信里直接发消息就会进入 DSH；要断开就点卡片底部整行实心的 **断开连接**。

## 状态与协议

登录状态机：`idle` / `requesting` / `waiting_qr` / `scanned` / `need_code` / `confirmed` / `failed`。

用到的 iLink 接口（请求头带 `Authorization: Bearer <bot_token>`、`iLink-App-Id: bot`，
body 带 `base_info`）：

| 接口 | 用途 |
| --- | --- |
| `POST /ilink/bot/get_bot_qrcode?bot_type=3` | 申请登录二维码 |
| `GET /ilink/bot/get_qrcode_status` | 长轮询扫码状态（`wait/scaned/confirmed/expired/need_verifycode/…`） |
| `POST /ilink/bot/getupdates` | 长轮询收消息（`ret/errcode = -14` 表示会话暂停） |
| `POST /ilink/bot/sendmessage` | 发消息（`message_type=2`、`message_state=2`，回复要回传 `context_token`） |
| `POST /ilink/bot/getuploadurl` | 申请媒体上传地址（AES-128-ECB 加密、`rawfilemd5`） |
| `POST /ilink/bot/getconfig` + `sendtyping` | 取 typing 票据 / 发输入状态 |
| `POST /ilink/bot/msg/notifystart` / `notifystop` | 渠道上下线通知 |

媒体下载优先用 `media.full_url`，否则拼 CDN `download?encrypted_query_param=…`；
AES 密钥优先 `image_item.aeskey`（32 位 hex），其次 `media.aes_key`（base64）。

### 已实测 / 待实测

**已实测**（本机直连腾讯接口）：

- `get_bot_qrcode` / `get_qrcode_status` 的字段与长轮询行为（约 30s 返回，未扫码时 `status: "wait"`）
- `getupdates` 的错误在响应 body 里（`errcode: -14`），HTTP 仍是 200
- 登录成功后的凭据结构 `{ bot_token, ilink_bot_id, baseurl, ilink_user_id }`

**待真机确认**（实现了防御式解析与单元测试，但还没有在真实账号上走通全链路）：

- `sendmessage` 的首包投递语义（是否需要先有入站 `context_token`）
- 媒体上传后微信客户端的展示效果（图片/文件）
- `sendtyping` 的实际可见性

## 安全

- token 只经 `ctx.credentials` 存取（默认 ref：`WEIXIN_CLAWBOT_CREDENTIAL`），**不写文件、不进日志、不回前端**。
- 前端只拿到掩码账号、节点 host、脱敏用户 id；白名单里是真实 id，但只存在宿主内存与 0600 状态文件里。
- 微信消息内容按「不可信用户输入」处理：文件落盘后正文会明确提示不要执行，仍由 Agent 的权限预设约束。
- 所有路由都过宿主鉴权边界（`connection.requestRejection`），并设 `cache-control: no-store`。
- 桥接默认开启、固定 allowlist：连接成功后只对本人（扫码的那个微信号）开放，其他人的消息被忽略。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉后不注册任何路由 |
| `credentialRef` | `WEIXIN_CLAWBOT_CREDENTIAL` | 凭据位置，独立于官方插件的 `WEIXIN_ILINK_CREDENTIAL` |
| `monitorOnConnect` | `true` | 登录后是否常驻监听 |
| `bridgeEnabled` | `true` | 连接成功即启用消息桥接；落盘的旧值 `false` 会被纠正为开启 |
| `bridgeAccessPolicy` | `allowlist` | 固定为 `allowlist`（仅本人）；`open` 只有在配置文件里显式写才生效 |
| `bridgeAllowFrom` | `[]` | 初始白名单（面板可以增删） |
| `bridgeAgentPreset` | `''` | 微信会话使用的 Agent 预设 |
| `bridgePermissionPreset` | `''` | 微信会话的权限预设（空 = 跟随宿主默认） |
| `bridgeWorkspace` | `''` | 微信会话的工作目录（空 = 用户主目录） |
| `bridgeIncludeImages` | `true` | 是否把入站图片作为图片块交给模型 |
| `bridgeRequestTimeoutMs` | `20000` | 普通 iLink 请求超时 |
| `bridgeApprovalTimeoutMs` | `120000` | 审批等待上限，超时按取消处理 |

## 限制

- `getupdates` 是**消费型**接口：同一账号同一时间只能有一个消费者。
  如果同时装了 `deepseek-harness-weixin`，必须关掉其中一个的监听，否则两边互抢消息。
- 语音只使用微信返回的转写文本（不解 SILK）；视频只提示不支持。
- 单个用户同一时间只允许一个待审批请求（第二个直接拒绝，避免串台）。
- 桥接等于「把微信文本当 prompt」，请务必使用 allowlist + 合适的权限预设。
- 目标平台只有 Web。

## 代码结构

> 想看「消息怎么走、会话归谁、什么时候切换」，见 [FLOW.md](FLOW.md)（五张流程图 + 判定表）。

```
host/
  index.js        模块入口：路由、服务装配、生命周期
  config.js       配置 schema 与规范化
  ilink.js        iLink 基础请求（登录/更新/鉴权头/base_info）
  login.js        扫码登录状态机与凭据写入
  monitor.js      getupdates 长轮询（唯一消费者）
  api.js          出站与媒体客户端（sendmessage / 上传 / 下载 / typing）
  media.js        AES-128-ECB 与 CDN 地址工具
  store.js        桥状态持久化（游标 / context_token / 去重 / 白名单）
  inbound.js      入站消息 → DSH content（图片块 + 文件落盘）
  markdown.js     出站文本整形（去 Markdown、按字节截断）
  conversation.js 微信用户 ↔ DSH Session 的映射与一轮对话
  approvals.js    审批请求 ↔ 微信回复
  commands.js     斜杠命令解析与帮助
  picker.js       首次选择卡：会话 / 工作区卡片、数字选择、挂起消息
  inspect.js      只读查询：当前会话 / 工作区 / 工作区下的会话
  bridge.js       编排：策略、去重、typing、命令、收发
client/           侧栏入口、面板、二维码、样式
```

模块代码采用 MIT 许可。二维码编码器为自研（Byte 模式、纠错等级 M、版本 1–10），
正确性由「生成矩阵 → 栅格化 → 解码回原文」的往返测试保证。
