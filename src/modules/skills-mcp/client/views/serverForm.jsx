import { CONNECTION_DRAFT_DEFAULTS } from '../../host/mcp/connection.js'
import { field } from '../components/field.jsx'
import { HINTS } from '../components/form.js'
import { hasInjectedPath } from '../components/card.jsx'

export function serverFormView({
  tier, editing, draft, setDraft, scopeDraft, setScopeDraft, projectChoices,
  error, busy, switchControl, onSave, onCancel,
}) {
  if (!editing || editing.kind !== "mcp" || editing.tier !== tier.tier) return null
  const profileEntry = typeof editing.profile === "string" && editing.profile !== "" ? editing.profile : null
  const stdio = (draft.transport ?? "streamable-http") === "stdio"
  return (
    <li className="smp-card" key="form" data-wide="true">
      <div className="smp-cardDetails" key="body">
        <div className="smp-formGrid" key="grid">
          {field("名称（serverName）", (
            <input
              className="smp-input"
              placeholder="例如 test，最多 32 字符"
              value={draft.serverName ?? ""}
              onChange={(e) => setDraft({ ...draft, serverName: e.target.value })}
            />
          ))}
          {field("传输", (
            <select
              className="smp-select"
              value={draft.transport ?? "streamable-http"}
              onChange={(e) => {
                const transport = e.target.value
                // Switching to stdio prefills `npx` **only when the field is still empty**:
                // a value the user typed (or one loaded from a row being edited) must not
                // be overwritten by a convenience default.
                const blank = String(draft.command ?? '').trim() === ''
                setDraft({
                  ...draft,
                  transport,
                  ...(transport === 'stdio' && blank ? { command: HINTS.command } : {}),
                })
              }}
            >
              <option value="streamable-http" key="h">streamable-http</option>
              <option value="stdio" key="s">stdio</option>
            </select>
          ))}
          {/*
            The scope picker, moved here from the toolbar.
            It used to *filter* the list by project, which only made sense while the
            project tier was a separate list of separately-stored entries. Now a
            server's scope is simply a property of that server, so the choice belongs
            where the server is created — and the same workspace list is reused.
          */}
          {field("作用域（哪个工作区可用）", (
            <div className="smp-scopePick" key="scope">
              <select
                className="smp-select"
                key="sel"
                value={scopeDraft.custom ? "__custom__" : (scopeDraft.value || "global")}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === "__custom__") { setScopeDraft({ value: '', custom: true }); return }
                  setScopeDraft({ value: value === 'global' ? '' : value, custom: false })
                }}
              >
                <option value="global" key="g">全局 —— 所有工作区都能用</option>
                {projectChoices.map(([path, title]) => <option value={path} key={path}>{title}</option>)}
                <option value="__custom__" key="c">自定义路径…</option>
              </select>
              {scopeDraft.custom ? (
                <input
                  className="smp-input" key="custom"
                  placeholder="项目绝对路径"
                  value={scopeDraft.value}
                  onChange={(e) => setScopeDraft({ ...scopeDraft, value: e.target.value })}
                />
              ) : null}
            </div>
          ))}
          {stdio
            ? field("命令", (
                <input
                  className="smp-input" placeholder={HINTS.command}
                  value={draft.command ?? ""}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                />
              ))
            : field("URL", (
                <input
                  className="smp-input" placeholder={HINTS.url}
                  value={draft.url ?? ""}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              ))}
          {/* http 的鉴权头：host 端按 KEY=VALUE 解析（parseEnv），所以提示也用等号。
              此前这个字段只在 form.js 里声明、从未渲染，等于没有写入入口。 */}
          {stdio
            ? null
            : field("请求头（KEY=VALUE，每行一个）", (
                <textarea
                  className="smp-textarea" rows={3} placeholder={HINTS.headers}
                  value={draft.headers ?? ""}
                  onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
                />
              ), true)}
          {stdio
            ? field("参数（空格分隔）", (
                <input
                  className="smp-input" placeholder={HINTS.args}
                  value={draft.args ?? ""}
                  onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                />
              ))
            : null}
          {stdio
            ? field("运行时", (
              /**
               * 用哪个 npm 家族去跑 stdio 服务器。
               *
               * 默认是 **system**，不是 Harness —— 这个默认值原来是反的，而反的那一侧
               * 根本跑不起来：Harness 自带的是 `node + pnpx`（内置 runtime 里没有 npm，
               * 所以当初只能换 pnpx），而 pnpx 解析到 pnpm store 里那份包时，**依赖没有
               * 被链接进去**：
               *
               *     Cannot find package 'zod' imported from
               *     ~/Library/pnpm/store/v11/links/@modelcontextprotocol/server-memory/…/
               *
               * store 的 links 目录里只有包本身（`node_modules/@modelcontextprotocol`），
               * 没有 `zod`。实测 `server-memory` / `server-filesystem` 都起不来，
               * `server-everything` 却能起来 —— 取决于包自己怎么引依赖，用户无从预判。
               *
               * 所以文案也不能再写「推荐」：「自带 node」是真的，但「能跑起来」是假的。
               * 现在的写法如实说明各自的适用范围，让碰到 pnpm 不兼容包的人知道该换哪边。
               */
                <select
                  className="smp-select"
                  value={draft.runtime ?? "system"}
                  onChange={(e) => setDraft({ ...draft, runtime: e.target.value })}
                >
                  <option value="system" key="system">系统 npx（推荐：能装齐依赖）</option>
                  <option value="auto" key="auto">跟随 Harness（自带 node + pnpx；个别包会缺依赖）</option>
                </select>
              ))
            : null}
          {stdio
            ? field("环境变量（KEY=VALUE，每行一个）", (
                <div className="smp-envField" key="env">
                  <textarea
                    className="smp-textarea" rows={3} placeholder={HINTS.env}
                    value={draft.env ?? ""}
                    onChange={(e) => setDraft({ ...draft, env: e.target.value })}
                  />
                  {/* 全局 stdio 行会被注入一条 PATH（让 npx/node 能被找到）。
                      它确实属于这一行，所以如实回填、不隐藏；但要讲清楚它是自动的，
                      否则用户会以为是自己配的，删掉就会让 stdio 服务器起不来。 */}
                  {hasInjectedPath(draft.env) ? (
                    <p className="smp-note" key="pathNote">
                      其中的 <code>PATH</code> 是 DSH 自动注入的（跟随系统 PATH，让 <code>npx</code>/<code>node</code> 能被找到）——保持原样即可，删掉会让这个 stdio 服务器启动失败。
                    </p>
                  ) : null}
                </div>
              ), true)
            : null}
          {/* 连接策略：直接落进 MCP 客户端的 failOnStartupError / reconnect.*。

              标题原来是「连接与重连（留空 = 用 DSH 默认值）」，但现在：
                · 这个字段里只有一个开关，没有可「留空」的东西；
                · 下面三个重连数字**预填了真实默认值**，也不再靠留空表达默认。
              一条让用户去找输入框的提示，旁边却没有输入框，比不写还糟。

              两个开关都用宿主自己的 `Switch`（与卡片上的启用开关同一个组件）：
              布尔设置用开关比用勾选框更符合这个设置页的语言，而且开关同时说明
              「现在是哪一档」，勾选框只说明「点了会怎样」。 */}
          {field("连接失败处理", (
            <div className="smp-switchRow" key="fail">
              <span className="smp-switchRowText">
                {"连不上时拒绝激活（failOnStartupError）"}
                <span className="smp-switchRowHint">默认关闭</span>
              </span>
              <span className="smp-switchSlot" key="slot">
                {switchControl(
                  draft.failOnStartupError === true,
                  (next) => setDraft({ ...draft, failOnStartupError: next }),
                  "连不上时拒绝激活（failOnStartupError）",
                )}
              </span>
            </div>
          ), true)}
          {/* 两个开关分属不同概念（连接策略 / OAuth 安全），中间要有一条横线。
              没有它时两块文字挨在一起，读起来像一个开关组里的两行，而不是两项
              各自独立的设置。`role="separator"` 让读屏也念出这是一处分隔。 */}
          <div className="smp-divider" role="separator" aria-orientation="horizontal" key="divider" />
          {/* 明文 token 端点的例外。**默认关闭**，而且刻意放在表单最下方、
              紧挨着连接设置：它是个安全降级，不该出现在显眼位置让人顺手打开。
              文案必须说清后果 —— 用户开它的时候要知道凭据会明文过网。 */}
          {field("内网 OAuth（仅 http 授权服务器）", (
            <div className="smp-switchRow" key="allowInsecure">
              <span className="smp-switchRowText">
                {"允许明文 token 端点"}
                <span className="smp-switchRowHint">
                  {"仅当授权服务器没有 TLS 时打开；开启后 access_token / refresh_token 会以明文发到内网，同网段可被嗅探"}
                </span>
              </span>
              <span className="smp-switchSlot" key="slot">
                {switchControl(
                  draft.allowInsecureTokenEndpoint === true,
                  (next) => setDraft({ ...draft, allowInsecureTokenEndpoint: next }),
                  "允许明文 token 端点",
                )}
              </span>
            </div>
          ), true)}
          {field("工具调用超时（ms）", (
            <input
              className="smp-input" type="number" min={1} step={1}
              placeholder={String(CONNECTION_DRAFT_DEFAULTS.toolCallTimeoutMs)}
              value={draft.toolCallTimeoutMs ?? ""}
              onChange={(e) => setDraft({ ...draft, toolCallTimeoutMs: e.target.value })}
            />
          ))}
          {field("重连首次延迟（ms）", (
            <input
              className="smp-input" type="number" min={1} step={1} placeholder={String(CONNECTION_DRAFT_DEFAULTS.reconnectInitialDelayMs)}
              value={draft.reconnectInitialDelayMs ?? ""}
              onChange={(e) => setDraft({ ...draft, reconnectInitialDelayMs: e.target.value })}
            />
          ))}
          {field("重连最大延迟（ms）", (
            <input
              className="smp-input" type="number" min={1} step={1} placeholder={String(CONNECTION_DRAFT_DEFAULTS.reconnectMaxDelayMs)}
              value={draft.reconnectMaxDelayMs ?? ""}
              onChange={(e) => setDraft({ ...draft, reconnectMaxDelayMs: e.target.value })}
            />
          ))}
          {field("重连最大次数", (
            <input
              className="smp-input" type="number" min={1} step={1} placeholder={String(CONNECTION_DRAFT_DEFAULTS.reconnectMaxAttempts)}
              value={draft.reconnectMaxAttempts ?? ""}
              onChange={(e) => setDraft({ ...draft, reconnectMaxAttempts: e.target.value })}
            />
          ))}
        </div>
        {error ? <div className="smp-error" key="err" style={{ marginTop: 8 }}>{error}</div> : null}
        {profileEntry !== null ? (
          <p className="smp-note" key="note" style={{ marginTop: 8 }}>
            {`改的是配置文件行 ${profileEntry.replace(/^include:/, "")}，Host 会写回 profile patch（自动备份）。`}
          </p>
        ) : null}
        <div className="smp-actionsRow" key="actions">
          <button
            className="smp-button" data-variant="primary" key="save"
            disabled={busy || !draft.serverName}
            onClick={onSave}
          >
            {profileEntry !== null ? "保存到配置行" : "保存"}
          </button>
          <button className="smp-button" data-variant="outline" key="cancel" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </li>
  )
}
