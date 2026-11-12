# 自部署 Server（dsh-toolkit · vendored）

**中文** · [English](README.md)

单账号、单进程的 DSH Remote Server：设备注册与凭据刷新、Control 控制通道、WebRTC（LAN / P2P / TURN）协商、端到端加密 Relay，以及本目录新增的 **device-pairing v1** 扫码配对。

> **来源声明**：本目录 vendored 自 [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote)（MIT，v0.6.4），并新增 `device-pairing v1`（`src/pairing.ts`）。上游为 pnpm workspace 布局，这里改造为独立 npm 包：协议源码 vendored 到 `src/protocol/`，只依赖 `ws` 与 `zod`；上游的 React 管理界面（`web/`）与其构建步骤已移除。许可证见 [LICENSE](LICENSE)。

## 用途

桌面端 DSH 插件（Host）与手机端（Client）需要一台常驻服务来做三件事：

1. **配对**：桌面显示二维码 → 手机扫码 → 手机显示 8 位验证码 → 用户把验证码输入桌面 → 双端各自拿到 credentials（新增的 device-pairing v1）。
2. **信令**：为两台设备协商 WebRTC 直连（LAN / P2P / TURN）；协商失败时自动回落到 Relay。
3. **Relay**：在无法打洞的网络里转发端到端加密的控制帧（Server 只见密文）。

Server 不保存任何明文凭据：state 文件里只有 token 的 SHA-256 摘要，Web 登录会话用 HttpOnly Cookie。

## 快速开始（本地）

需要 Node.js >= 22。

```bash
cd server
npm install && npm run build && npm start
```

`npm start` 之前的 `npm run build` 会把 TypeScript 编译到 `dist/`；开发时可用 `npm run dev`（`tsx watch`，免编译）。

最小配置（其余变量可留空）：

```bash
export DSH_SERVER_ACCOUNT=owner@example.com
export DSH_SERVER_PASSWORD='replace-with-a-long-random-password'   # 至少 12 位
npm start
```

管理界面已移除，`GET /` 会返回 404 `METHOD_NOT_FOUND`（静态资源与 SPA 回退逻辑保留：把产物放进 `dist/public/` 就会自动生效）；验证启动用 `curl http://127.0.0.1:8080/healthz`（返回 `{"status":"ok"}`），人类可读的配对说明在 <http://127.0.0.1:8080/pair>。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_SERVER_ACCOUNT` | 无（必填） | 单账号模型的账号标识，例如邮箱。 |
| `DSH_SERVER_PASSWORD` | 无（必填） | 账号密码，**至少 12 个字符**。改动密码会立即让所有既有设备凭据失效。 |
| `DSH_SERVER_PUBLIC_URL` | 回落为 `http://localhost:<port>` | 客户端实际访问的 origin，例如 `https://remote.example.com`。用于 origin 校验与签发 TURN 凭据，不要填容器内部地址或带路径；**强烈建议显式设置**，否则跨机器访问时 origin 校验会失败。 |
| `DSH_SERVER_HOST` | `127.0.0.1` | 监听地址。默认只听本机；放进容器/需要对外时设为 `0.0.0.0`。 |
| `DSH_SERVER_PORT` | `8080` | 监听端口。 |
| `DSH_SERVER_DATA_FILE` | `./data/state.json` | 状态文件路径（设备、token 摘要、账号校验值），权限 0600，目录 0700。 |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | 空 | 逗号分隔的可信反向代理 IP 字面量。非空时请求必须带**恰好一个** `X-Forwarded-For`（单个 IP 字面量），否则 400；留空则一律忽略该头、按 socket 地址限流。只接受裸 IPv4/IPv6，端口、CIDR、域名会让启动失败。 |
| `DSH_SERVER_HELLO_TIMEOUT_MS` | `5000` | WebSocket hello 握手超时（1000-60000）。 |
| `DSH_SERVER_HEARTBEAT_INTERVAL_MS` | `25000` | 心跳间隔（5000-120000）。 |
| `DSH_SERVER_HEARTBEAT_DISCONNECT_MS` | `75000` | 心跳断连阈值（50000-600000，且 >= 2× 心跳间隔）。 |
| `DSH_SERVER_FORCE_TERMINATE_GRACE_MS` | `1000` | 半关闭连接的强制终止宽限（100-10000）。 |
| `DSH_SERVER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`。 |
| `DSH_SERVER_STUN_URLS` | 空 | 逗号分隔的 STUN URL。留空则只走 Relay。 |
| `DSH_SERVER_TURN_URLS` | 空 | 逗号分隔的 TURN URL。 |
| `DSH_SERVER_TURN_SECRET` | 空 | coturn `static-auth-secret`（REST API），Server 据此签发短期凭据，永不外泄 secret。 |
| `DSH_SERVER_TURN_USERNAME` / `DSH_SERVER_TURN_PASSWORD` | 空 | 静态 TURN 账号；与 `TURN_SECRET` 二选一，不能同时设置。 |
| `DSH_SERVER_TURN_TTL_SECONDS` | `300` | TURN 凭据有效期（60-3600）。 |

越界或非法的可选值会打印一条 warning 并回退到默认值，启动不会失败；`ACCOUNT` / `PASSWORD` 缺失或非法会直接启动失败，`PUBLIC_URL` 不设置时代码会回落成 `http://localhost:<port>`（仅适合本机调试）。完整示例见 [.env.example](.env.example)。

## HTTP 端点

无需认证：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health`、`/healthz`、`/ready` | `{"status":"ok"}`。 |
| GET | `/pair` | 配对指引页（无脚本、`no-store`、严格 CSP）。 |
| GET | `/api/v1/auth/oauth/providers` | `{"capabilities":{"devicePairing":"dsh-pairing-v1","devicePairingQr":"fragment-ticket-v1"},"items":[]}`。桌面端按 `devicePairingQr === 'fragment-ticket-v1'` 决定二维码用短格式（`<origin>/pair#v1.<scanSecret>`）。 |
| GET | `/api/v1/device-pairing/capabilities` | 同上（仅能力字段）。 |
| POST | `/api/v1/device-pairing/sessions` | 创建配对会话，`{v:1, device:{role:'host',...}}`。 |
| POST | `/api/v1/device-pairing/resolve` | `{ticket}` → 复用 `state=created` 的会话信息。 |

配对会话端点（除 `resolve`/创建外都需要 `X-DSH-Pairing-Proof`，见下）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/device-pairing/sessions/{id}/claim` | 手机提交 `{scanSecret, device:{role:'client',...}}`，返回 8 位验证码。 |
| POST | `/api/v1/device-pairing/sessions/{id}/host/status` | Host 侧状态（含 `submissionId` 与 credentials）。 |
| POST | `/api/v1/device-pairing/sessions/{id}/mobile/status` | 手机侧状态（`submissionId` 恒为 `null`）。 |
| POST | `/api/v1/device-pairing/sessions/{id}/host/confirm` | `{submissionId, verificationCode}`，成功后一次性注册双端设备并签发 token。 |
| POST | `/api/v1/device-pairing/sessions/{id}/host/cancel` | 取消会话。 |
| POST | `/api/v1/device-pairing/sessions/{id}/mobile/cancel` | 取消会话。 |

账号 / 设备（沿用上游）：

| 方法 | 路径 | 认证 |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | 账号密码 → 8 小时 HttpOnly Cookie + 账号 token；按 IP 20 次/分钟。 |
| GET | `/api/v1/auth/me` | Cookie 会话。 |
| POST | `/api/v1/auth/logout` | Cookie 会话。 |
| GET | `/api/v1/account/devices` | Cookie 会话，列出全部设备。 |
| POST | `/api/v1/devices/register` | 账号 token，注册一台设备。 |
| POST | `/api/v1/devices/register-owned-role` | 设备 token，以相反角色注册自己的另一台设备。 |
| POST | `/api/v1/auth/refresh` | `{deviceId, refreshToken}`，轮换并可从丢失的响应中恢复。 |
| DELETE | `/api/v1/devices/self` | 设备 token，撤销自己并断开其 socket。 |
| GET | `/api/v1/me` | 设备 token，返回自己的描述。 |
| GET | `/api/v1/devices` | Client 设备 token，列出可用 Host。 |
| GET | `/api/v1/devices/{id}`、`/presence` | 订阅自己的设备或查询同账号设备的在线状态。 |
| POST | `/api/v1/devices/{id}/name` | 账号 token，改名。 |
| GET | `/api/v1/turn/credentials?connection_id=` | 连接参与者，签发短期 TURN 凭据。 |
| WS | `/ws/v1/connect` | 控制通道（hello → hello.ack，心跳、connect、signal、relay、ping）。 |

此外所有 `/api/v1/*` 共享 240 次/分钟/IP 的上限，超出返回 429 `RATE_LIMITED`。错误统一为 `{"error":{"code","message","requestId","retryable"}}`。

## device-pairing v1 状态机

```
created --claim--> claimed --host/confirm(验证码正确)--> approved --> completed
   |                  |                                        |
   |                  +--host/confirm(验证码错误)--> failed     +--注册失败--> failed
   +--cancel--> cancelled                claimed/created --cancel--> cancelled
   任意活跃状态超过 expiresAt --> expired
```

- 会话有效期固定 **180 秒**（`expiresAt = created + 180000`），`recoverUntil = expiresAt + 300000`；过了 `recoverUntil` 再访问返回 404 `PAIRING_NOT_FOUND`。
- 每个会话有自己的 X25519 密钥对；`serverPublicKey` / `scanSecret` / 设备 `identityKey` 都是 32 字节的 **base64url 无 padding 43 字符**。
- 验证码是 8 位十进制（保留前导零），用 `crypto.randomInt` 生成；错误一次即 `state=failed`、`failureReason=verification_failed`（HTTP 200，不泄露期望值，也不允许再试）。
- `confirm` 成功后在同一事务内注册 Host 与手机两台设备并各自签发 token：`account=dsh-device:<uuid>`、`accountKind=device_only`、`pairingRestricted=true`，Host 侧 `inboundOnly=true`、手机侧 `false`；任何一步失败则 `state=failed` 且不留半套 token。
- 幂等：同一个 `submissionId` + 完全相同请求体重放返回同一份 credentials；换一个 `submissionId` 返回 409 `PAIRING_ATTEMPT_USED`。

请求体上限 **8192 字节**（超出 413 `FRAME_TOO_LARGE`），必须是严格 JSON（重复键、非法 UTF-8、多余字段、缺字段都返回 422 `INVALID_MESSAGE`）；无数据端点必须发 `{}`。

## 配对 proof

除 `resolve` 与创建会话外的所有配对端点都要求：

```
X-DSH-Pairing-Proof: base64url(HMAC-SHA256(proofKey, UTF8("POST\n" + exactPath + "\n" + lowercaseHex(SHA256(UTF8(rawBodyText))))))
```

其中 `proofKey = HKDF-SHA256(ikm = X25519(session 私钥, 对方 identityKey), salt = UTF8(sessionId), info = UTF8("dsh-pairing-v1/" + side), L = 32)`，`side` 为 `host` 或 `mobile`，`exactPath` 是实际请求 pathname（如 `/api/v1/device-pairing/sessions/<id>/claim`）。校验失败一律 403 `PAIRING_FORBIDDEN`，不透露具体原因。

## Docker 部署

```bash
cd server
cp .env.example .env
# 编辑 .env：至少设置 DSH_SERVER_ACCOUNT / DSH_SERVER_PASSWORD / DSH_SERVER_PUBLIC_URL
docker compose up -d --build server
```

- 镜像构建走 `npm ci` + `npm run build`，运行时只带 `dist/`、`node_modules`（prod）与 manifest，以 `node` 非 root 用户运行。
- 容器内默认 `DSH_SERVER_HOST=0.0.0.0`、`DSH_SERVER_DATA_FILE=/data/state.json`，数据落在 `server-data` 卷：`docker compose down` 不会丢设备；`down -v` 会。
- 健康检查每 30 秒请求一次 `/healthz`。
- 生产环境请用 HTTPS 反向代理，不要把 Node 端口直接暴露到公网；`DSH_SERVER_PUBLIC_URL` 必须与浏览器实际 origin 完全一致（含 scheme 与端口），否则静态资源与 origin 校验会失败。
- 改了 `.env` 之后要 `docker compose up -d --force-recreate server`，`docker compose restart` 不会重新读取环境变量。

## 测试

```bash
npm install
npm run build
npm test          # vitest run，真实起 HTTP server（端口 0），全程离线
```

覆盖：账号/设备授权与凭据轮换恢复、Control 帧校验与 Relay 路由、WebRTC 信令与 TURN 凭据、反向代理限流、hello 超时与状态机、日志脱敏、配置归一化，以及 device-pairing v1 全流程（创建 → 领取 → 错误验证码 → 正确确认 → 双端 credentials 可用、幂等重放、过期、proof 失败、超大请求体、非法 identityKey、resolve 404）。

此外 `tests/pairing-compat.test.ts` 用上游 `fixtures/pairing/v1/proof.json`（Python `cryptography` 生成、NSec 独立验证）作为外部基准，校验 proof 算法逐字节一致，并把官方 fixture 的 host/mobile/confirm proof 直接打到本服务的真实端点上；同一文件里的 zod schema 逐字复制自官方 `pairing-contract.ts`（全部 `.strict()`），因此也验证了响应字段集不多不少。

## 与官方客户端的兼容性

已按 `packages/plugin/src/{host-pairing,pairing-contract,server-api}.ts` 的实际解析逻辑实现，刻意保持一致的点：

- 能力字段名与取值（`devicePairing` / `devicePairingQr`）、二维码文本格式 `<origin>/pair#v1.<scanSecret>`、`X-DSH-Pairing-Proof` 算法与 `POST\n{path}\n{sha256hex}` 拼接方式；
- 创建响应与 status 响应的字段集（strict schema，多一个字段客户端就解析失败），`submissionId` 只在 Host 侧返回；
- `expiresAt` 不超过 `now + 240000`、Host identityKey 回显校验；
- `GET /api/v1/auth/oauth/providers` 返回 404 时客户端视为「不支持配对」，这里始终返回 200。

已知差异 / 风险：

- **`deviceId` 与 `platform` 校验被放宽**（`src/protocol/index.ts`）：上游只接受 ULID/UUID 和 `^[a-z0-9][a-z0-9._-]*$`，配对协议允许任意 1..128 标识与大小写平台名（`macOS` / `iOS`）。官方客户端发的是 UUIDv7 + 小写平台，因此收紧或放宽都不影响现有链路；放宽只是为了让第三方客户端也能注册。
- **错误码**：proof 失败这里返回 403 `PAIRING_FORBIDDEN`（协议文档写作 401 `PAIRING_PROOF_INVALID`），文档本身允许实现二选一；超过 8192 字节返回 413 `FRAME_TOO_LARGE`（文档写作 422 `INVALID_MESSAGE`）。
- **设备注册前置校验**：`confirm` 时设备会再走一遍 store 的设备校验（256 台上限、identity 不可变更、已撤销不可复用）。若官方客户端送来非法描述，会话会以 `state=failed` + `failureReason=PAIRING_DEVICE_CONFLICT` 结束，而不是签发半个凭据。
- **扫码端 `dsh-Go`**：本机上游 checkout 里没有 Dart 客户端（`packages/dsh_remote` 尚未实现），手机侧只按协议文档与桌面端解析逻辑验证，未做真机联调。

未完成项：上游 `web/` 管理界面已移除（`GET /` 返回 404 `METHOD_NOT_FOUND`，只有 `/pair` 是无脚本的指引页，因此没有 SPA）；上游依赖 client-stack（Noise / WebRTC / Plugin HTTP 客户端）的测试场景未移植，等价行为用原始 HTTP/WebSocket 断言覆盖。

## 目录结构

```
server/
├── src/
│   ├── main.ts        # 读环境变量、启动、优雅退出
│   ├── server.ts      # HTTP 路由、CORS/origin、限流、静态资源回退
│   ├── pairing.ts     # device-pairing v1（新增）
│   ├── gateway.ts     # WebSocket 控制通道、Relay、WebRTC 信令
│   ├── store.ts       # 设备与 token 摘要持久化、轮换与恢复
│   ├── config.ts      # 环境变量解析与归一化
│   ├── ice.ts         # STUN/TURN 配置与短期凭据
│   ├── logger.ts      # 单行 JSON 日志 + 脱敏
│   └── protocol/      # vendored 自上游 packages/protocol
├── tests/             # vitest：server / pairing / pairing-compat / refresh-recovery
├── Dockerfile, compose.yaml, .env.example
├── LICENSE            # 上游 MIT
└── README.md / README.zh.md
```

## 许可

MIT，见 [LICENSE](LICENSE)。上游版权归 *DSH Remote contributors*；本目录仅在 `src/pairing.ts` 等处新增 device-pairing v1，并做了上文所述的独立包改造。
