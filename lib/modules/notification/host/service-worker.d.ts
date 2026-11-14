/**
 * 通知点击处理器（Service Worker）的脚本体。
 *
 * 为什么需要它：`new Notification(...)` 的生命周期绑在页面上，页面一刷新/关闭通知就跟着
 * 消失，点击也无从处理。交给 SW 之后通知由注册持有，页面死了它还在通知中心里，点击会在
 * `notificationclick` 里被接住——这时可以聚焦已有窗口，或按通知里记的 URL 新开一个。
 *
 * 刻意**不注册 `fetch` 处理器**：这个 SW 的 scope 被放宽到了站点根（见 constants.ts），
 * 一旦拦截请求就可能把整个应用拖下水。没有 fetch 监听时浏览器直接走网络，等价于不存在。
 *
 * 注意：这是纯 JS 源码，会被原样当文本发给浏览器，不能出现任何 TS 语法。
 */
export declare const SERVICE_WORKER_SOURCE = "/* dsh-toolkit notification click handler */\nconst OPEN_MESSAGE = 'dsh-toolkit:notification:open'\n\nself.addEventListener('install', () => { self.skipWaiting() })\n\n// \u7ACB\u523B\u63A5\u7BA1\u5DF2\u6253\u5F00\u7684\u9875\u9762\uFF1A\u5426\u5219\u88C5\u5B8C\u8981\u7B49\u4E0B\u4E00\u6B21\u5BFC\u822A\u624D\u751F\u6548\uFF0C\u7B2C\u4E00\u6B21\u70B9\u51FB\u901A\u77E5\u65F6\u8FD8\u627E\u4E0D\u5230\u7A97\u53E3\u3002\nself.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })\n\nself.addEventListener('notificationclick', (event) => {\n  const notification = event.notification\n  const data = (notification && notification.data) || {}\n  if (notification) notification.close()\n  if (event.action === 'dismiss') return\n  event.waitUntil(reveal(data))\n})\n\n/**\n * \u4F18\u5148\u805A\u7126\u5DF2\u6709\u7A97\u53E3\u5E76\u8BA9\u5B83\u8DF3\u5230\u5BF9\u5E94\u4F1A\u8BDD\uFF1B\u6CA1\u6709\u7A97\u53E3\u624D\u6309\u901A\u77E5\u91CC\u8BB0\u7684 URL \u65B0\u5F00\u4E00\u4E2A\u3002\n * @param {object} data \u53D1\u901A\u77E5\u65F6\u585E\u8FDB notification.data \u7684\u8F7D\u8377\u3002\n */\nasync function reveal(data) {\n  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''\n  let windows = []\n  try {\n    windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })\n  } catch (error) {\n    windows = []\n  }\n  for (const client of windows) {\n    try {\n      await client.focus()\n      client.postMessage({ type: OPEN_MESSAGE, sessionId })\n      return\n    } catch (error) {\n      // \u8FD9\u4E2A\u7A97\u53E3\u805A\u7126\u4E0D\u4E86\uFF08\u4F8B\u5982\u5DF2\u88AB\u5173\u6389\uFF09\uFF1A\u8BD5\u4E0B\u4E00\u4E2A\u3002\n    }\n  }\n  if (typeof data.url === 'string' && data.url !== '') {\n    try {\n      await self.clients.openWindow(data.url)\n    } catch (error) {\n      // \u6253\u5F00\u5931\u8D25\u5C31\u6CA1\u522B\u7684\u529E\u6CD5\u4E86\uFF1A\u901A\u77E5\u5DF2\u7ECF\u5173\u6389\uFF0C\u7528\u6237\u81EA\u5DF1\u5207\u56DE\u6807\u7B7E\u9875\u5373\u53EF\u3002\n    }\n  }\n}\n";
/**
 * 挂上 SW 脚本路由。
 *
 * 这条路由**不鉴权**（`registerRoute` 而非 `registerAuthenticatedRoute`）：浏览器注册 SW
 * 时独立发脚本请求，带不上页面 URL 里的 token。脚本里只有常量与事件处理，没有数据。
 * @param ctx - 宿主上下文。
 */
export declare function registerNotificationServiceWorkerRoute(ctx: any): void;
//# sourceMappingURL=service-worker.d.ts.map