# 测试、UI/Web 验证与视觉截图（AGENTS.md §10–§11 细则）

> 从 AGENTS.md 拆出，内容不变；改这类约定时先改这里，再看 AGENTS.md 的摘要要不要同步。

## 10. 测试

- `tests/<group>/*.test.mjs`，runner 是 `node:test`，DOM 用 `jsdom`（`pretendToBeVisual: true`）。
- **UI 用例单独跑**：`pnpm test:ui`。它们一个文件就要几百 MB（jsdom + React + esbuild），
  `pnpm test` 默认跳过；真实交互优先起 `dsh web` 在浏览器里点，见 10.1。
- 测试 import 源码时写 `.js` / `.jsx`（`jsx-hooks` 负责解析到 `.ts` / `.tsx`）；但**把路径当字符串**用的地方
  （esbuild `entryPoints`、`readFileSync`、`loadClientEntry`）必须写真实扩展名。
- 断言要抓真问题：状态映射 / 降级路径 / 卸载清理 / 迟到响应，而不是只跑通 happy path。
- **断言里不要直接 `assert.equal(<DOM 节点>, null)`**：失败时 Node 的 `inspectValue` 会以
  `depth: 1000` / `sorted: true` 展开 jsdom 节点，顺着 DOM 上的 `__reactFiber$…` 走完整棵 React 树
  （实测单次失败吃掉 5–6GB，把 16GB 机器连同 DSH 一起 OOM）。用 `assert.ok(node === null, msg)`。
- **`vm.runInNewContext` 的沙箱要补齐浏览器全局**：新上下文只有 ECMAScript 内建，没有
  `AbortSignal` / `AbortController` / `Headers` / `fetch`。`fetchJson` 现在给每个请求套
  `AbortSignal.timeout()`，漏一个就表现为「请求没发出 + 对话框不关」。
- **已知的本机失败**（Windows，不要误判为回归）：`tests/pet/service.test.mjs:75` 断言
  `assetDir.startsWith('/')`。`assetDir` 是**真实文件系统绝对路径**（`D:\…`），被
  `pet/host/runtime/core.cjs` 的 `pet-asset://` 协议用 `path.isAbsolute()` 校验后再 `assetJoin()`
  拼路径；强行补前导 `/` 会让 `path.join('/pets/x','a.webp')` 变成 `\pets\x\a.webp`（当前盘根相对），
  helper 反而读不到图。这条断言是 POSIX-only，不要为了让它变绿去改源码。
- `tests/judgment/ledger.test.mjs` 的「并发 ask 原子占用配额」在全量并行下偶发失败，单跑稳定通过 ——
  先复跑该文件再判断是否回归。

### 10.1 Web 端 UI 验证：token 与那条 401

`dsh web` 的认证是**每个进程一次性**的：进程启动时随机生成 32 字节 launch token（只在内存里，
不落盘、进程退出即消失），只打印一行

```
dsh web: http://127.0.0.1:<port>/?token=<base64url>
```

`GET /?token=…` 校验通过才种下 HttpOnly + `SameSite=Strict` + HMAC 签名的会话 cookie（签名密钥
持久化在 credentials 的 `client-connection/browser-session`），303 到 `./`；此后每个请求靠 cookie。
裸根没有 cookie，就回 401 纯文本 `dsh web authentication required; reopen the URL printed by dsh web.`

- **这条 401 是「服务活着、只是没身份」，不是启动失败。** 别据此换端口、改代码或重启；
  真正的启动失败是 `EADDRINUSE`（端口被占）、TLS 材料读不了、前端 dist 没建（checkout 里先 `pnpm run build`）。
- **token 拿不到就别想"自动登录"**：它只在进程内存里，桌面端那份也不写盘；`DSH_WEB_URL`（以及 agent
  运行时上下文里的 `http://127.0.0.1:61678`）是*公告地址*，按设计永远不带凭据。所以能自动点 UI 的前提是
  **你自己拥有那个 `dsh web` 进程**——把它当后台任务起、从 stdout 抓 `^dsh web: ` 那一行。
- 常用起法（`--no-open` 免得抢用户浏览器；端口自选）：

  ```bash
  dsh --profile web --no-open --port 6180
  # stdout: dsh web: http://127.0.0.1:6180/?token=...
  ```

  抓到 URL 后**先用它访问一次**（换 cookie），再回 `./`；脚本里用 cookie jar（`curl -c/-b`）或持久化
  浏览器 profile，别每次重新抓 token。cookie 绑定 authority（`host:port`）：换端口 / 换主机名立刻回到 401，
  重新抓那一行即可；进程重启 token 会变，但 cookie 仍然有效（直到 `cookieMaxAgeDays`）。
- 起来之后的自检（三步的期望值是 **401 → 303 → 200**，都不是失败）：

  ```bash
  TOKEN=$(grep -m1 -o 'token=[A-Za-z0-9_-]*' web.log | cut -d= -f2)
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6180/                      # 401
  curl -s -c jar -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:6180/?token=$TOKEN" # 303 + set-cookie
  curl -s -b jar -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6180/                # 200
  ```

  顺手把 `web.log`、`jar` 删掉：前者是凭据，后者是会话。
- 干净 `DSH_HOME` 上第一次 `--profile web` 会先把模板落进 `$DSH_HOME/profiles/web`，实测 1 分钟内就打印
  URL；这期间出现 `skipping profile bundle "…"` 只是某个可选 bundle 没装（`dsh plugin --profile <name> install`），
  不影响服务起来。
- **本仓库的 UI 只在 desktop profile 里**（§12 的 `link:` 安装）；`--profile web` 只装了
  `@deepseek-ai/dsh-base` + `dsh-web-app` + `sidebar-mobile`，直接起 web 看到的是没有 dsh-toolkit 的界面。
  要验本仓库的页面，先把仓库 link 进 web profile（步骤同 §12），再按上面起。
- 已经跑着的桌面端（61678）**不适合当测试靶子**：它的 token 不可读，只有用户浏览器里那份 cookie；
  用一个干净的浏览器去开它必然 401。

---

## 11. 视觉/样式改动怎么验证

```powershell
# 1) 生成还原 DSH DOM 的页面（抽 .cache/bundles 的真实 CSS + 源码 CSS）
node .cache/x/build2.mjs demo-available.html available windows
# 2) 截图（& 抓不到 stdout，必须 Start-Process 重定向）
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList @("--headless=new","--disable-gpu","--hide-scrollbars",
    "--force-device-scale-factor=2","--window-size=1280,900","--virtual-time-budget=1200",
    "--screenshot=D:\项目\dsh-toolkit\.cache\x\shot.png",
    "file:///D:/项目/dsh-toolkit/.cache/x/demo-available.html") -Wait -NoNewWindow
```

- 需要真实 `:hover` 时用 CDP 派发 `Input.dispatchMouseEvent`（`.cache/x/hover.mjs`），不要加假类名。
- 图片裁切/拼接用外置 Python：`D:\DeepSeekHarness-home\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`。

---

