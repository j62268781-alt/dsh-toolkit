# dsh-toolkit-weixin-clawbot

在 **DeepSeek Harness 的 Web UI 里**扫码连接微信 ClawBot（腾讯 iLink 协议）通道。侧栏底部点一下、扫一下，不需要命令行，二维码直接画在浏览器里。

这是为「`dsh web` 由 systemd 托管、没有 tty、终端二维码进 journald 看不到」这个场景写的。本模块**不依赖、不 import、也不修改** `deepseek-harness-weixin`，是全新独立实现。

## 使用

在仓库根目录执行 `pnpm install && pnpm build`，随后把本目录作为 DSH bundle 安装。聚合包 `dsh-toolkit` 也包含此模块。

1. 展开左侧栏，鼠标移到侧栏底部的 **微信连接**。
2. 弹出卡片后点 **连接微信**。
3. 手机微信扫码，并在微信里确认。
4. 卡片变成 **已连接**，显示脱敏账号与节点 host。
5. 点 **测试通道** 可以确认通道真的通；点 **断开连接** 会清空凭据。

卡片默认「鼠标离开即关闭」；卡片底部的开关可以让它保持展开。

## 状态与协议

| 状态 | 含义 |
| --- | --- |
| `idle` | 未连接 |
| `requesting` | 正在向 iLink 申请二维码 |
| `waiting_qr` | 二维码已显示，等待扫码 |
| `scanned` | 已扫码，等待微信确认 |
| `need_code` | 微信要求输入手机端显示的数字校验码 |
| `confirmed` | 授权成功，凭据已写入 `ctx.credentials` |
| `failed` | 失败（错误原因会显示在卡片里） |

协议按腾讯 iLink ClawBot 流程实现：

- `POST https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3`
- `GET  .../ilink/bot/get_qrcode_status?qrcode=...`（长轮询，服务端约 30s 返回）
- `POST .../ilink/bot/getupdates`（登录后用 token 长轮询收消息）

### 已实测 / 待实测

**已实测**（本机直连腾讯接口确认）：

- `get_bot_qrcode` 返回 `{ ret, qrcode, qrcode_img_content }`，`qrcode_img_content` 就是二维码 URL
- `get_qrcode_status` 是长轮询，约 30 秒才返回，未扫码时 `status: "wait"`
- `getupdates` 的错误在响应 **body** 里（`errcode: -14`），HTTP 仍是 200

**待实测**（实现里做了防御式解析，缺字段会报可读错误而不是编造）：

- `confirmed` 状态下 `bot_token` / `ilink_bot_id` / `baseurl` / `ilink_user_id` 的确切取值形态
- `getupdates` 返回的 `msgs[].item_list[].text_item.text` 文本结构

## 安全

- token 只经 `ctx.credentials` 存取（默认 ref：`WEIXIN_CLAWBOT_CREDENTIAL`），**不写文件、不进日志、不回前端**。
- 前端拿到的账号信息是掩码的（首尾各 4 位，中间打码）；节点只给 host。
- 二维码 URL 是短生命周期凭据，只在 `login/start` 的响应里回给前端，不打印到服务端日志。
- 所有路由都经过宿主的鉴权边界（`connection.requestRejection`），并设 `cache-control: no-store`。

## 常驻监听的取舍

登录成功后默认开启 `getUpdates` 常驻监听，用于显示「最近一条消息」证明通道是通的。

**注意**：`getupdates` 是**消费型**接口，同一账号被两个消费者同时轮询会互相抢消息。如果本模块开着监听，`deepseek-harness-weixin` 等其他桥接就拿不到同一条消息，反之亦然。可以随时在服务配置里把 `monitorOnConnect` 设为 `false` 关掉常驻监听，只保留「测试通道」按钮的单次探测。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉后不注册任何路由 |
| `credentialRef` | `WEIXIN_CLAWBOT_CREDENTIAL` | 凭据位置，独立于官方插件的 `WEIXIN_ILINK_CREDENTIAL` |
| `monitorOnConnect` | `true` | 登录后是否常驻监听 |

三个字段都是 volatile，可以在运行时修改，不需要重启宿主。

## 限制

- 只做登录与通道自检，**不做完整的消息收发桥接**。
- 不处理图片、文件、AES 媒体。
- 不做斜杠命令与工具审批。
- 目标平台只有 Web。

模块代码采用 MIT 许可。二维码编码器为自研（Byte 模式、纠错等级 M、版本 1–10），正确性由「生成矩阵 → 栅格化 → 解码回原文」的往返测试保证。
