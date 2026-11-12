# 生产部署：systemd + HTTPS 反向代理（可选 TURN）

本目录是 `server/`（`dsh-toolkit-server`）的自托管部署模板。三份配置文件加一份环境变量示例：

| 文件 | 用途 |
| --- | --- |
| `dsh-server.service` | systemd 单元：常驻、崩溃自动重启、权限收紧 |
| `env.example` | systemd 读取的环境变量（`/etc/dsh-toolkit-server.env`） |
| `Caddyfile` | Caddy v2 反代 + 自动证书 |
| `nginx.conf` | Nginx 反代（自带证书，如 certbot） |
| `coturn.conf` | 可选：TURN/STUN，用于 WebRTC 打洞失败时的回落 |

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

- Server 只监听 `127.0.0.1:8080`，公网只开 443（和可选的 TURN 端口）。
- 手机与桌面都通过 `https://<你的域名>` 访问；`DSH_SERVER_PUBLIC_URL` 必须与这个 origin 完全一致。
- 配对会话 180 秒，手机显示 8 位验证码，桌面输入后完成绑定；凭据保存在 Server 的状态文件里。

## 1. 准备主机

- Linux（Debian 12 / Ubuntu 22.04+ 均可），公网 IP，域名 A/AAAA 记录已指向它。
- 防火墙放行 80/443；若配 TURN，再放行 3478/udp、5349/tcp、49152–65535/udp。
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

## 7. 可选：TURN（只有 WebRTC 打洞失败才需要）

不配 TURN 也能工作：Server 会走 Relay 中转，只是延迟略高。需要 P2P 直连时：

```bash
sudo apt install -y coturn
sudo sed -i 's/^#TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo cp deploy/coturn.conf /etc/turnserver.conf   # 再按注释改域名/公网 IP/secret
sudo systemctl enable --now coturn
```

- **A 方案（推荐）**：`static-auth-secret` 与 `DSH_SERVER_TURN_SECRET` 填同一个随机串；Server 每次签发短期凭据，secret 不外泄。
- **B 方案**：`user=` 静态账号，与 `DSH_SERVER_TURN_USERNAME`/`DSH_SERVER_TURN_PASSWORD` 对应。两者不能同时设置。
- `external-ip` 必须是公网 IP（云主机 NAT 场景尤其重要），否则客户端拿到的 relay 候选不可达。
- 自检：用 Trickle ICE 或 `turnutils_uclient -u <user> -w <pass> turn.example.com` 确认 3478/udp 通。

配好后在环境变量里加：

```bash
DSH_SERVER_STUN_URLS=stun:turn.example.com:3478
DSH_SERVER_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
DSH_SERVER_TURN_SECRET=<与 static-auth-secret 相同>
```

然后 `sudo systemctl restart dsh-server`。

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
| TURN 不通 | `external-ip` 未配置、端口没放行、`TURN_URLS` 与 coturn 的端口/传输不一致，或 secret/账号不匹配。 |
| systemd 起不来，日志写不进状态文件 | 状态目录不在单元的 `ReadWritePaths`，或属主不是 `dsh`。 |

## 10. 安全清单

- Server 端口只监听 `127.0.0.1`，公网仅暴露反代的 443。
- `/etc/dsh-toolkit-server.env` 与 `state.json` 保持 `0600`（目录 `0700`），不要进 git。
- 定期轮换 `DSH_SERVER_PASSWORD`；轮换后重新配对设备。
- 反代不要开目录浏览、不要加 `auth_basic`、不要缓存 `/api/` 与 WebSocket。
- 备份 `state.json` 之后再升级；`docker compose down -v` 之类会清卷的操作同样会清掉设备。
