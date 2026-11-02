/**
 * dsh-shell-kit — Host 半个插件。
 *
 * 这个包装了三件事：
 *   1. Client 半（./lib/client.js）：注入一份全局样式表，把桌面外壳改成
 *      「52px 图标栏 + 定宽工作区面板 + 白色圆角卡片」的形态，并在设置里加一页
 *      「已归档的聊天」；
 *   2. Host 半（这份文件）：往 index.html 里注入启动画面（style + html + script
 *      三段），在 React 挂载之前就把「鲸鱼被一笔笔画出来」的开机动画放上去；
 *   3. **删除会话的本地通道**：DSH 内核没有删除会话的接口，但会话在磁盘上就是
 *      一个目录。这里起一个只监听 127.0.0.1 的小 HTTP 服务，页面侧（设置页的
 *      「删除」按钮）带着运行时令牌来调用，把它移进回收站。
 *
 * ── 为什么启动画面必须走 Host 而不是 Client ────────────────────────────
 *
 * Client 插件要等模块图装配完、浏览器拿到 bundle 之后才执行 —— 那时应用已经
 * 挂载，开机画面早就过去了。Host 侧有 `webserver/index-inject` 这个表：
 * 订阅者往 table 里 push 行，宿主渲染 index.html 时把行拼进去；桌面端则通过
 * `dshDesktopBoot.ready()` 拿到同一份表再注入。于是我们的样式/结构/脚本
 * 和 DSH 自己的主题引导行处在同一层级、同一个时机。
 *
 * 行只有五种形态：global / script / script-src / script-preload / style / html
 * （见 @deepseek-ai/dsh-host-webserver 的 renderRow）。启动画面用其中三种：
 *   · style    → 进 <head>，首屏前就生效，不会闪一下白
 *   · html     → 紧随 <body>，早于应用脚本
 *   · script   → 同样紧随 <body>，负责计时、检测应用挂载、淡出
 *
 * 动画本身是纯 CSS + 内联 SVG（见 host/boot.css / boot.html），零 canvas、
 * 零 rAF、零网络请求 —— 冷启动时不该和插件装配抢主线程。
 *
 * ── 为什么删除会话要另起一个端口，而不是走 Remote 服务 ────────────────
 *
 * Client → Host 的正规通道是 Typert Remote 服务（`ctx.remote.workspace` 那一套）。
 * 但客户端能用哪些 namespace 是**宿主构建期**生成的，第三方插件没有那个代码
 * 生成步骤，塞不进新的 namespace。退一步用宿主自己的 webserver 也不成 ——
 * 它只开放了 `webserver/index-inject` 一个扩展点，没有路由注册。
 *
 * 于是这里起一个**独立的 loopback 服务**：只绑 127.0.0.1、端口随机、每次启动
 * 重新生成令牌，令牌和端口通过 index-inject 写进页面（`window.__SK_HOST`）。
 * 页面拿不到令牌就调不动，别的进程也不知道端口 —— 这不比 Remote 差多少，而且
 * 完全在插件自己的代码里，不依赖任何未公开的接缝。
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { rm, rename, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

/** 插件名，与 package.json 的 name 保持一致。 */
export const name = "dsh-shell-kit";

/** sessions：删除前要确认这条会话没在内存里被打开着。 */
export const inject = ["sessions"];

/** 启动画面的三个资源，按需读一次并缓存（插件被逐出时随进程一起消失）。 */
let bootAssets;

function readBootAssets() {
  if (bootAssets === undefined) {
    const read = (file) =>
      readFileSync(new URL(`./modules/shell/host/${file}`, import.meta.url), "utf8");
    bootAssets = {
      css: read("boot.css"),
      html: read("boot.html"),
      script: read("boot.js"),
    };
  }
  return bootAssets;
}

/**
 * DSH 用户目录（`$DSH_HOME`，默认 `~/.dsh`）。
 *
 * @returns {string} 绝对路径。
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".dsh");
}

/**
 * 删除一条会话：把它的磁盘目录移进回收站。
 *
 * DSH 一个会话 = `<home>/sessions/<workspace 目录名>/<sessionId>/`，里面是
 * `session.lock` 与 `session.v4.jsonl.zstd`。工作区目录名是把路径里的 `/` 换成
 * `-` 得到的，所以这里遍历 `sessions/*` 找同名目录，而不是拼路径 —— 拼路径
 * 会在路径里有连字符时猜错。
 *
 * 归档状态在 `<home>/storages/workspace.json` 的 `global.archivedSessionIds` 里，
 * 这里**不动它**：那个文件正被运行中的 workspace 服务持有，背后改会被覆盖；
 * 而残留的 id 解析不到会话时会被客户端自动过滤掉（DSH 自己就有 40 条这样的记录）。
 *
 * @param {string} sessionId - 会话 id。
 * @returns {Promise<{ok: boolean, moved?: string, reason?: string}>}
 */
async function deleteSessionFiles(sessionId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    return { ok: false, reason: "invalid-session-id" };
  }

  const home = dshHome();
  const sessionsRoot = join(home, "sessions");
  const trashRoot = join(home, "dsh-delete-session-trash");

  // 1. 在 sessions/<任意工作区>/ 下找这一条
  let found = null;
  let entries = [];
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return { ok: false, reason: "no-sessions-directory" };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(sessionsRoot, entry.name, sessionId);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        found = candidate;
        break;
      }
    } catch {
      // 不在这个工作区目录下，继续找
    }
  }
  if (found === null) return { ok: false, reason: "not-found" };

  // 2. 移进回收站（同一块磁盘，rename 是原子的，不会出现删一半）
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashPath = join(trashRoot, `${stamp}-${sessionId}`);
  try {
    await rename(found, trashPath);
  } catch (error) {
    return { ok: false, reason: `move-failed: ${error.message}` };
  }

  // 3. 投影缓存一起带走（没有就跳过）
  const cache = join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
  try {
    await rename(cache, join(trashRoot, `${stamp}-${sessionId}.projcache.json`));
  } catch {
    // 没有缓存文件是常态
  }

  return { ok: true, moved: trashPath };
}

/**
 * 起一个只服务本机页面的删除通道。
 *
 * @param {import("cordis").Context} ctx - Host 上下文。
 * @param {(endpoint: {url: string, token: string}) => void} publish - 把端点告诉 index 注入。
 * @returns {{url: string, token: string, dispose: () => void}}
 */
function startHostBridge(ctx, publish) {
  const token = randomBytes(24).toString("hex");
  const server = createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-sk-token",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const send = (code, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(code, { ...cors, "content-type": "application/json" }).end(body);
    };
    if (req.method !== "POST" || req.url !== "/delete-session") {
      send(404, { ok: false, reason: "not-found" });
      return;
    }
    if (req.headers["x-sk-token"] !== token) {
      send(403, { ok: false, reason: "forbidden" });
      return;
    }

    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8_192) req.destroy();
    });
    req.on("end", () => {
      let sessionId;
      try {
        sessionId = JSON.parse(raw)?.sessionId;
      } catch {
        send(400, { ok: false, reason: "bad-json" });
        return;
      }
      if (typeof sessionId !== "string" || sessionId === "") {
        send(400, { ok: false, reason: "bad-session-id" });
        return;
      }
      // 内存里还活着（刚打开过 / 正在跑）就先不删：文件被持有，删了容易留半截。
      const live = ctx.sessions?.get?.(sessionId);
      if (live !== undefined && live !== null) {
        send(409, { ok: false, reason: "session-loaded" });
        return;
      }
      deleteSessionFiles(sessionId)
        .then((result) => send(result.ok ? 200 : 404, result))
        .catch((error) => send(500, { ok: false, reason: error.message }));
    });
  });

  const endpoint = { url: "", token };
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address !== null && typeof address === "object") {
      endpoint.url = `http://127.0.0.1:${address.port}`;
      publish(endpoint);
      ctx.logger?.("dsh-shell-kit")?.debug?.(`delete bridge on ${endpoint.url}`);
    }
  });
  server.unref?.();

  return {
    get endpoint() {
      return endpoint;
    },
    dispose() {
      server.close();
    },
  };
}

/**
 * 把 Host 侧的注入行挂进 index.html 的注入表。
 *
 * 每次 emit 都会重新收集，所以这里读缓存即可：资源是静态的，跟着插件版本走。
 *
 * @param {import("cordis").Context} ctx - Host 侧 cordis 上下文。
 */
export function apply(ctx) {
  let current = null;

  const bridge = startHostBridge(ctx, (endpoint) => {
    current = endpoint;
  });

  ctx.on("webserver/index-inject", (table) => {
    const { css, html, script } = readBootAssets();
    table.push(
      { kind: "style", text: css },
      { kind: "html", placement: "body", html },
      { kind: "script", placement: "body", text: script },
    );
    // 删除通道的端点。页面用它调本机服务；没有它，「删除」按钮会自己禁用。
    if (current !== null && current.url !== "") {
      table.push({
        kind: "script",
        placement: "body",
        text: `window.__SK_HOST = ${JSON.stringify({ deleteUrl: current.url, token: current.token })};`,
      });
    }
  });

  ctx.effect(() => () => bridge.dispose(), "dsh-shell-kit:delete-bridge");

  ctx.logger?.("dsh-shell-kit")?.debug?.(
    "shell kit loaded: client stylesheet + boot screen injection + delete bridge",
  );
}

export default { name, inject, apply };
