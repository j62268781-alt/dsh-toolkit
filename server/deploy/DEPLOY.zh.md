# 生产部署：systemd + HTTPS 反向代理

本目录是 `server/`（`dsh-toolkit-server`）的自托管部署模板。三份配置文件加一份环境变量示例：

| 文件 | 用途 |
| --- | --- |
| `dsh-server.service` | systemd 单元：常驻、崩溃自动重启、权限收紧 |
| `env.example` | systemd 读取的环境变量（`/etc/dsh-toolkit-server.env`） |
| `Caddyfile` | Caddy v2 反代 + 自动证书 |
| `nginx.conf` | Nginx 反代（自带证书，如 certbot） |

> 只想本机/局域网跑一跑，看 [README.zh.md](../README.zh.md#快速开始本地) 就够了；想用容器，看 [Docker 部署](../README.zh.md#docker-部署)。本文是「一台有域名的公网服务器」的完整步骤。

## 0. 结构预览

```
手机 DSH-Go ──HTTPS/WSS──► Caddy/Nginx :443
                              │  反代 127.0.0.1:8080
                              ▼
                       dsh-toolkit-server (systemd, 用户 dsh)
                              │  状态文件 /var/lib/dsh-toolkit-server/state.json
                              ▼
                    桌面 DSH（ds-harness-remote host）──WSS──► 同一个 Server
```

- Server 只监听 `127.0.0.1:8080`，公网只开 443。
- 手机与桌面都通过 `https://<你的域名>` 访问；`DSH_SERVER_PUBLIC_URL` 必须与这个 origin 完全一致。
- 配对会话 180 秒，手机显示 8 位验证码，桌面输入后完成绑定；凭据保存在 Server 的状态文件里。

## 1. 准备主机

- Linux（Debian 12 / Ubuntu 22.04+ 均可），公网 IP，域名 A/AAAA 记录已指向它。
- 防火墙放行 80/443 即可：直连（LAN/P2P）不占服务器端口，Relay 走的是 443 上的同一条 WebSocket。
- 不需要 Docker，也不需要数据库：状态就是一个 JSON 文件。

安装 Node.js 22（NodeSource 示例，其他发行版用对应仓库）：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs rsync
node -v   # 应 >= v22
```

创建运行用户与目录：

```bash
sudo useradd --system --create-home --home-dir /var/lib/dsh-toolkit-server --shell /usr/sbin/nologin dsh
sudo install -d -m 0750 -o dsh -g dsh /opt/dsh-toolkit-server /var/lib/dsh-toolkit-server
```

## 2. 部署代码

在仓库里（或用 `git clone` 到服务器后进入 `server/`）：

```bash
sudo rsync -a --delete \
  --exclude node_modules --exclude dist --exclude tests --exclude .env \
  ./ /opt/dsh-toolkit-server/

cd /opt/dsh-toolkit-server
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev
sudo chown -R root:root /opt/dsh-toolkit-server
```

- `npm ci` 需要 devDependencies（TypeScript），所以顺序必须是「安装 → 构建 → 裁剪」。
- 构建产物在 `dist/`，运行时只需要 `dist/`、`node_modules`（prod）、`package.json`。

## 3. 配置环境变量

```bash
sudo install -m 0600 deploy/env.example /etc/dsh-toolkit-server.env
sudoedit /etc/dsh-toolkit-server.env
```

至少改这四项：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `DSH_SERVER_ACCOUNT` | `owner@example.com` | 单账号标识，登录配对用 |
| `DSH_SERVER_PASSWORD` | 长随机串 | **至少 12 位**；改密码会让所有既有设备凭据失效 |
| `DSH_SERVER_PUBLIC_URL` | `https://remote.example.com` | 与浏览器地址完全一致，不要带路径/端口（除非确实非 443） |
| `DSH_SERVER_DATA_FILE` | `/var/lib/dsh-toolkit-server/state.json` | 必须落在单元声明的 `ReadWritePaths` 里 |

反代与 Server 同机时保留 `DSH_SERVER_TRUSTED_PROXY_IPS=127.0.0.1`；Server 与反代不同机时填反代的实际出口 IP（裸 IP，不支持 CIDR/域名）。

`DSH_SERVER_TRANSPORTS` 默认 `lan,relay`（同 Wi-Fi 直连 + 其余走 Relay）。想让手机在流量下也尝试
P2P 时改成 `lan,p2p,relay`，前提是两端都有可直连的公网地址；打不通会先白等 12 秒，详见[第 7 节](#7-让手机流量也直连可选stun--p2p)。

## 4. 启动 systemd 服务

```bash
sudo cp deploy/dsh-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-server

systemctl status dsh-server --no-pager
journalctl -u dsh-server -f        # 看启动日志
curl -s http://127.0.0.1:8080/healthz   # {"status":"ok"}
```

常见启动失败：`DSH_SERVER_ACCOUNT`/`DSH_SERVER_PASSWORD` 缺失（直接退出）、`DSH_SERVER_DATA_FILE` 所在目录不在 `ReadWritePaths`（`ProtectSystem=strict` 下写不进去）、状态目录属主不是 `dsh`。

## 5. 配 HTTPS 反代（二选一）

### A. Caddy（自动证书，最省事）

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/remote\.example\.com/你的域名/g' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy 默认就转发 WebSocket 的 Upgrade 头，并且会把 `X-Forwarded-For` 设成单个客户端 IP（覆盖而非追加）——正好满足 `TRUSTED_PROXY_IPS` 的硬性要求，所以模板里不需要手动写 `header_up`。

### B. Nginx（已有证书）

```bash
sudo apt install -y nginx
sudo cp deploy/nginx.conf /etc/nginx/conf.d/dsh-server.conf
sudo sed -i 's/remote\.example\.com/你的域名/g' /etc/nginx/conf.d/dsh-server.conf
# 证书路径按实际调整（certbot 默认在 /etc/letsencrypt/live/<域名>/）
sudo nginx -t && sudo systemctl reload nginx
```

必须保留的三点：`proxy_http_version 1.1`、`Upgrade`/`Connection` 头、`X-Forwarded-For $remote_addr`（单值覆盖，不要 `$proxy_add_x_forwarded_for`）。模板按 Debian 12 自带的 nginx 1.18–1.22 写成 `listen 443 ssl http2`；nginx ≥ 1.25.1 改成 `listen 443 ssl;` + `http2 on;`。

### C. 不用反代：云负载均衡 / 直接跑

Server 进程本身**只监听 http**（`src/server.ts:207` 用 `node:http` 建服务，没有任何 TLS 选项），所以
"直接跑"能不能用，取决于前面有没有东西替它终结 TLS：

| 你的实际形态 | 结论 |
| --- | --- |
| 云厂商 HTTPS 负载均衡 → 你的 `:8080` | 可用。把 LB 的**空闲超时**（阿里云 SLB「连接空闲超时」/ 腾讯云 CLB「空闲超时」）从默认 60s 调到 **≥ 900s**，否则长连接会被 LB 静默掐断 |
| 公网裸跑 `http://1.2.3.4:8080` | **不可用**。DSH-Go 只接受 `https://`，或**私网地址**上的 `http://`（`packages/dsh_remote/lib/src/relay/dsh_remote_backend.dart:57-60` 的 `normalizeServerUrl`） |
| 纯内网/VPN 内 `http://10.x.x.x:8080` | 可用，此时没有 TLS 也没有 LB，`DSH_SERVER_PUBLIC_URL=http://10.x.x.x:8080` |

必须放在同一个 HTTPS 域名后面的原因不只是加密：客户端发 `hello` 时 `Origin` 必须等于 `PUBLIC_URL`，
并且 `X-Forwarded-For` 得是**单个**客户端 IP（`DSH_SERVER_TRUSTED_PROXY_IPS` 只认裸 IP，不支持 CIDR）。

如果只是想省掉 nginx，用 Caddy 一个文件仍然是最省事的（自动证书 + 自动处理 Upgrade + 单值 XFF）：

```bash
# 系统里已有 80/443 证书时也可换成 tls /path/cert.pem /path/key.pem
sudo apt install -y caddy && sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
```

## 6. 验证

```bash
# 1) 服务健康
curl -s https://remote.example.com/healthz
# {"status":"ok"}

# 2) 能力声明：应包含 "devicePairingQr":"fragment-ticket-v1"
curl -s https://remote.example.com/api/v1/device-pairing/capabilities

# 3) WebSocket 升级（端点固定为 /ws/v1/connect，且 Origin 必须等于 PUBLIC_URL）
npx wscat -c "wss://remote.example.com/ws/v1/connect" -H "origin: https://remote.example.com"
# 能连上（随后按协议发 hello 帧）就说明反代没丢 Upgrade；403 说明路径带错了查询串或 Origin 不匹配
```

端到端：

1. 桌面 DSH 打开「远程连接 → 手机连接」，把配对服务器改成 `https://remote.example.com`；
2. 点「生成配对二维码」，用手机 DSH-Go 扫码；
3. 手机显示 8 位验证码 → 桌面输入 → 显示「手机已绑定到本机」；
4. 面板里断线原因、重连都正常（说明 WebSocket 与心跳都通了）。

## 6.1 手机端长连接调参（手机 4G/5G 强烈建议）

手机在移动网络 + 后台调度下，WS 会周期性"卡住"几秒到一分钟。服务端侧有三处默认值对这种情况偏紧，
`deploy/env.example` 里已经是下面这组推荐值，**代码里的 fallback 仍是上游原值**（不配就用原值）：

| 变量 | 默认（代码 fallback） | 推荐值 | 为什么 |
| --- | --- | --- | --- |
| `DSH_SERVER_HEARTBEAT_DISCONNECT_MS` | 75000 | `180000` | 3 轮心跳没回 pong 就判死；180s ≈ 容忍 5 轮丢包，手机进隧道/电梯不再一断到底 |
| `DSH_SERVER_HEARTBEAT_INTERVAL_MS` | 25000 | `30000` | 兼作 NAT/LB 保活；同时把上面那条的"判死窗口"拉长 |
| `DSH_SERVER_HELLO_TIMEOUT_MS` | 5000 | `12000` | 弱网冷启动时 hello 往返常常超过 5s，超时直接踢连接 |
| `DSH_SERVER_MAX_FRAMES_PER_SEC` | 512 | `2048` | 超限是**直接关连接**（close 4001），不是回错误；大段输出/日志刷屏时会被误判成断网 |
| `DSH_SERVER_SLOW_CONSUMER_BYTES` | 16 MiB | `16777216` | 单帧上限 1 MiB，手机下行一卡发送缓冲就堆到 4 MiB（旧硬编码阈值）→ `SLOW_CONSUMER` 断线；本版已可配 |

改完 `systemctl restart dsh-server`（这些值在启动时读一次）。先测量再调整：

```bash
# 按断线原因分类，决定动哪个参数
journalctl -u dsh-server | grep -o 'ws_peer_disconnected.*code[^,]*' | sort | uniq -c | sort -rn
# SLOW_CONSUMER        → 调大 DSH_SERVER_SLOW_CONSUMER_BYTES
# RATE_LIMITED         → 调大 DSH_SERVER_MAX_FRAMES_PER_SEC
# CONNECTION_REPLACED  → 客户端重复连（同一设备来了新 socket），查客户端重连退避
# CONNECTION_FAILED    → 心跳超时，查 ws_heartbeat_timeout 那行的 elapsedMs / thresholdMs
```

客户端侧（DSH-Go）有两件事不在服务端控制范围内：

- 它的 WS 看门狗是 `3 × heartbeatIntervalMs`（服务端下发的 `heartbeatIntervalMs`，默认 25s → 75s 无任何帧就自己关掉 socket 重连），
  所以服务端把 interval 调大，客户端容忍窗口会**同步变大**；
- 重连是指数退避 `1→30s`、最多 8 次，用完进入 `failed`，需要人工点重试（或 app 回到前台/网络切换时才再试）。



## 7. 让手机流量也直连（可选：STUN + P2P）

默认 `DSH_SERVER_TRANSPORTS=lan,relay`：同 Wi-Fi 直连，其余一律走 Relay，**不会**去尝试打洞。
手机走 4G/5G 时能否直连，取决于两端能不能拿到可直连的地址——国内移动网络多为 CGNAT，
IPv4 基本打不通；只有两端都有公网 IPv6 时才现实。

| 手机与桌面所在网络 | 实际路径 |
| --- | --- |
| 同一个局域网（同一 Wi-Fi / 同一 VPC 内网可互通） | **直连**：双方交换 host candidate，Server 只转发信令，业务数据不过服务器 |
| 不同网络（手机 4G/5G、公司网与家里网） | 回落 **Relay**：所有帧经 Server 的加密 WebSocket 转发 |

想尝试 P2P：先配好下面的 STUN，再把 `DSH_SERVER_TRANSPORTS` 改成 `lan,p2p,relay`。
打洞失败时客户端要等满一次 12 秒的 WebRTC 超时（服务端下发的 `webrtcFallbackTimeoutMs`）
才回落 Relay——这就是默认不开 P2P 的原因：在打不通的网络里它只会拖慢首连。


### 7.1 先做这一步：只配 STUN（零成本，通常已经够用）

客户端**没有内置 ICE 服务器**（`packages/webrtc/src/adaptive-transport.ts` 的
`fetchIceServers` 在没有配置时返回空数组），因此不配 STUN 时只能收集 host candidate：
同局域网仍直连，跨网（手机 4G/5G）在约 4 秒内失败（`DEFAULT_EMPTY_ICE_NEGOTIATE_TIMEOUT_MS`）
后回落 Relay。只补 STUN 就能尝试 P2P 打洞，多数「手机流量必须绕服务器」的情况到此为止。

国内公共 STUN（2026-11-15 从国内宽带实测，UDP 绑定请求应答；第三方服务，无 SLA，失效就删）：

| 地址 | 实测延迟 | 备注 |
| --- | --- | --- |
| `stun:stun.hitv.com:3478` | 29–242 ms | 芒果TV（hitv.com 是其站点域名），有按源 IP 的限速 |
| `stun:stun.chat.bilibili.com:3478` | 40–76 ms | B站，最稳 |
| `stun:stun.miwifi.com:3478` | 66–104 ms | 小米路由器 |
| `stun:stun.douyucdn.cn:18000` | 152 ms | 斗鱼，端口是 **18000**（3478 关闭） |

已失效 / 不可达，别抄：`stun.l.google.com:19302`、`stun.qq.com:3478`、`stun.douyucdn.cn:3478`、
`stun.cdnbye.com:3478`、`openrelay.metered.ca`（免费 Open Relay Project 已停服，DNS 现指向
`192.0.2.1`）。`stun.mgtv.com`、`stun.hunantv.com`、`stun.bytedance.com`、`stun.iqiyi.com` 等
域名都不存在，别去找。

```bash
DSH_SERVER_STUN_URLS=stun:stun.hitv.com:3478,stun:stun.chat.bilibili.com:3478,stun:stun.miwifi.com:3478,stun:stun.douyucdn.cn:18000
```

重启后用手机**关闭 Wi-Fi 走流量**重连，看面板里的连接方式是否从「中继」变成「P2P」；
仍是「中继」说明两端都没有可直连的公网地址（CGNAT），属于预期。

## 8. 升级与回滚

```bash
# 升级：覆盖代码 → 重装依赖 → 重建 → 重启
sudo rsync -a --delete --exclude node_modules --exclude dist --exclude tests --exclude .env \
  ./ /opt/dsh-toolkit-server/
cd /opt/dsh-toolkit-server && sudo npm ci && sudo npm run build && sudo npm prune --omit=dev
sudo systemctl restart dsh-server
```

- 状态文件是向前兼容的 JSON，升级不会清设备；但**备份**仍是必要的：
  `sudo cp /var/lib/dsh-toolkit-server/state.json /var/backups/dsh-state-$(date +%F).json`
- 回滚：把代码切回旧版本重复上面步骤即可；若旧版本不认新状态字段，启动会拒绝并打印原因，先从备份恢复状态文件。
- 改密码 = 让所有既有设备凭据立即失效（手机/桌面需要重新配对），这是有意的安全语义。

## 9. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 反代返回 400 `INVALID_HOST` / 400 无 body | `TRUSTED_PROXY_IPS` 非空但 `X-Forwarded-For` 不是单个 IP：检查 Caddy/Nginx 是否覆盖成单个客户端 IP，以及 Server 是否把反代 IP 配对了。 |
| `GET /` 返回 404 | 正常：上游管理界面已移除；用 `/healthz`、`/pair` 或手机客户端验证。 |
| 手机扫码后一直「等待确认」 | Server 的 `DSH_SERVER_PUBLIC_URL` 与手机访问的 origin 不一致（比如少了 https、端口不同）；也可能是 180 秒会话已过期，重新生成二维码。 |
| 配对时报 `PAIRING_FORBIDDEN`（403） | 设备时钟偏差过大（proof 有窗口）或请求体被代理改写；先校时（`timedatectl`），再确认反代没改 body。 |
| 请求 413 `FRAME_TOO_LARGE` | 请求体 > 8192B；检查反代是否塞了额外内容，别把 `client_max_body_size` 配得过小（模板给 16k）。 |
| 手机连上就断 / 反复重连 | WebSocket 没升级成功：Nginx 缺 `Upgrade`/`Connection` 头或 `proxy_http_version 1.1`；Caddy 一般无此问题。看 `journalctl -u dsh-server` 是否有 hello 超时。 |
| 桌面端 `401 CLIENT_CREDENTIALS_STALE` | 服务端改了密码或轮换了凭据；桌面重新登录 DSH CLI，再在面板里重新配对。 |
| 面板提示「账号冲突」 | 该设备在 Server 上还剩旧账号：点面板里的「解绑并重试」，或删 `~/.dsh/ds-harness-remote/servers/<hash>/host/server-credentials.json` 后重开。 |
| systemd 起不来，日志写不进状态文件 | 状态目录不在单元的 `ReadWritePaths`，或属主不是 `dsh`。 |

## 10. 安全清单

- Server 端口只监听 `127.0.0.1`，公网仅暴露反代的 443。
- `/etc/dsh-toolkit-server.env` 与 `state.json` 保持 `0600`（目录 `0700`），不要进 git。
- 定期轮换 `DSH_SERVER_PASSWORD`；轮换后重新配对设备。
- 反代不要开目录浏览、不要加 `auth_basic`、不要缓存 `/api/` 与 WebSocket。
- 备份 `state.json` 之后再升级；`docker compose down -v` 之类会清卷的操作同样会清掉设备。
