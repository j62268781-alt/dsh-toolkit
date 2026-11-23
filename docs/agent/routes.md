# 路由与 HTTP 约定（AGENTS.md §9 细则）

> 从 AGENTS.md 拆出，内容不变；改这类约定时先改这里，再看 AGENTS.md 的摘要要不要同步。

## 9. 路由与 HTTP 约定

- 前缀一律 `/api/plugins/toolkit/<module>/…`，由 `src/host/paths.ts` 的 `pluginApiPath()` 派生；
  **不要在 client 里手写路径字符串**。唯一允许覆盖的是 mobile 的 `config.routePrefix`。
- 注册走 `src/host/routes.ts`；`registerAuthenticatedRoute` 在旧宿主调用
  `ctx.connection.requestRejection(req)`；新版由 WebServer 按 `auth: 'required'` 完成准入，
  handler 只接受仍有效的 owner Peer。**身份拒绝先于读 body**。
- `jsonRoute` 的 spec：

  ```ts
  { path, kind?: 'exact'|'prefix', method?: 'POST'|'GET', limit?: number, auth?: boolean,
    pick?(body): unknown, check?(value): boolean, reason?: string,
    run(ctx, value): [number, unknown] | Promise<[number, unknown]> }
  ```

  它负责：`cache-control: no-store` → method 不符 404 `{ok:false,reason:'not-found'}` → 读 body 并
  `JSON.parse`（坏 JSON → 400 `bad-json`）→ `pick` / `check`（false → 400 `reason`）→ `run` 抛错 →
  `asHttpFailure(error)` 折算成状态码与 `{ok:false,reason}`。
- **失败只有一个通道**：域层要表达「这次请求不允许」就 `throw httpFailure(400, '请求体不是合法 JSON')`，
  不要再 `Object.assign(new Error(msg), { statusCode: 400 })`（历史上 remote 手搓了 3 处，现已统一）。
  `asHttpFailure(error, fallback)` 认三种输入：`HttpFailure` 实例 → 用它自己的 `status`/`reason`；
  带 `statusCode` 的老式错误 → 用该码（兼容既有测试对 `error.statusCode` 的断言）；其余 → `fallback` + `message`。
  `HttpFailure` 同时暴露 `.status` 与 `.statusCode`（后者是兼容别名，新代码只用 `.status`）。
- `limit` 只管「多大算超限」，**业务上限（比如批量条数）写在 `check()` 或域层**，不要在 `routes/` 里
  手写第二套长度判断。
- **`limit` 的单位是解码字符**（`readCharBody`），不是字节：8192 个中文字符必须被接受，
  8193 个必须 `req.destroy()` 且**永不响应**。
- 只有「浏览器顶跳回来、不该要宿主身份」的回调才用 `auth:false`（现状：OAuth 回调，靠 `state` 保护）。
  另一类例外是**浏览器自己发起的静态脚本请求**：注册 Service Worker 时由浏览器独立取 `sw.js`，
  带不上页面 token，所以它走裸 `registerRoute`（`src/modules/notification/host/service-worker.ts`）。
  这类路由必须同时满足：只回固定文本、不读请求体、不加 `no-store` 之外的状态、显式写
  `service-worker-allowed` 头，并在测试里断言「`connection.requestRejection` 一次都没被调」。
- webServer 不存在时要能降级：`ctx.inject(['webServer','connection'], ...)`。

---

