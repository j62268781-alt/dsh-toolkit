/**
 * OAuth 命令路由：`POST /<name>/oauth`。
 *
 * ## 为什么不用 settings 队列
 *
 * 「发起授权」必须**立刻**返回一个授权 URL 给面板显示 —— 那是用户下一步要点的东西。
 * settings 队列的往返是：写文档 → Host 500ms 轮询 → 处理 → 投影发布 → 面板轮询，
 * 实测 2–4 秒。让用户盯着一个空白弹窗等 4 秒才出现链接，是不可接受的交互。
 * 这与 `rows.js` / `skills/route.js` 的取舍完全一致。
 *
 * ## 命令集合
 *
 *   · `status`   —— 读一台服务器的授权状态（有无令牌、是否过期、是否等着用户去授权）；
 *   · `authorize`—— 发起授权，返回 `{ kind: 'redirect' | 'authorized', authorizeUrl }`；
 *   · `logout`   —— 清除凭据。
 *
 * 完成授权**不**走这条路由：它由授权服务器的浏览器跳转触发，见 `callback.js`。
 *
 * ## 安全
 *
 * 与 `rows.js` 同级别：
 *   · `connection.requestRejection(req)` —— 面板是同源且带 cookie，所以通过；别的页面不通过；
 *   · 只接受 POST + `application/json`（简单 HTML 表单发不出这个类型）；
 *   · 请求体用 zod schema 校验，未知字段进不来；
 *   · **绝不返回令牌本体**，只返回「有/没有、何时过期」。
 */
import { NAME } from '../../identity.js'
import { readBody, sendJson } from '../../../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../../../host/routes.js'
import { createSerialQueue } from '../../../../../host/serial.js'

export const OAUTH_PATH = `/${NAME}/oauth`

/** 命令体上限。一次命令就几百字节。 */
const MAX_BODY = 8 * 1024

/**
 * 注册 OAuth 命令路由。
 *
 * @param ctx - 带 `webServer` / `connection` 的 cordis 上下文。
 * @param options.schema - zod schema（Host 侧定义），`authorize`/`logout` 必填 `serverName`。
 * @param options.run - `(op) => Promise<object>`，已校验的命令交给它执行。
 */
export function registerOAuthRoute(ctx: any, { schema, run }: any) {
  const queue = createSerialQueue()

  registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: OAUTH_PATH,
    handler: async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      const type = String(req.headers?.['content-type'] ?? '')
      if (!type.includes('application/json')) {
        res.statusCode = 415
        res.end(JSON.stringify({ ok: false, reason: 'content-type must be application/json' }))
        return
      }
      const send = (status: any, payload: any) => sendJson(res, status, payload)
      let op
      try {
        op = schema(JSON.parse(await readBody(req, MAX_BODY)))
      } catch (error: any) {
        send(400, { ok: false, reason: String(error?.message ?? error) })
        return
      }
      await queue.run(async () => {
        try {
          send(200, await run(op))
        } catch (error: any) {
          ctx.logger.warn('dsh-toolkit-skills-mcp: oauth command failed: %s', String(error?.message ?? error))
          send(200, { ok: false, reason: String(error?.message ?? error) })
        }
      })
    },
  })
}
