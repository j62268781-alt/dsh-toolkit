import { Chevron } from '../components/chevron.jsx'
import { detailNodes, rowDetailPairs, toolsForServer } from '../components/card.jsx'
import { toolListNode } from '../components/toolList.jsx'

export function profileCardView({
  row, tier, rowKey, rowOpen, rowStatusScope, setExpanded, scopeTagLabel, statusDot,
  pending, pendingText, rowOpsReady, enabledSwitch, moreMenu, menuItems,
  serverTools, serverToolsError, filterFor, leafOf, writeFilter, filterState, needsAuthNote,
}) {
  return (
    <li className="smp-card" key={`profile:${row.entryId}`}>
      <div className="smp-cardRow" key="row">
      <div className="smp-cardMain" key="main">
      <div className="smp-cardHead" key="head">
        <button
          className="smp-cardToggle" key="toggle" aria-expanded={rowOpen}
          onClick={() => setExpanded(rowOpen ? "" : rowKey)}
        >
          <Chevron key="c" open={rowOpen} />
          <span className="smp-cardIdentity" key="name">
            {row.serverName || row.entryId}
            {/* 作用域跟着名字走：它描述的是「这台服务器是谁的」，与右边的运行状态
                （连没连上）是两件事。
                全局行也带标签：列表现在跨工作区混排，一个没标签的卡片会让人以为
                「它没有归属」，而事实是「它属于所有工作区」。两个页签用同一套词表
                （全局 / 工作区名），所以 MCP 与 Skills 的卡片读起来一致。 */}
            <span className="smp-tag" data-tone="neutral" key="scope">{scopeTagLabel(row.scope)}</span>
          </span>
        </button>
        <span className="smp-cardEnd" key="end">
          {/* 停用时状态圆点整组不渲染：没有连接可报告，留着过期的绿点会撒谎。
              关掉这件事本身由右边的开关表达（灰点 + 「已关闭」是同一个意思，
              两个都画只是重复）。 */}
          {row.enabled === false ? null : statusDot(row.serverName, tier, rowStatusScope)}
        </span>
      </div>
      <div className="smp-cardDescription" key="desc">
        {row.target
          ? `${row.transport || "streamable-http"} · ${row.target}`
          : `${String(row.entryId).replace(/^include:/, "")}${row.phase ? ` · ${row.phase}` : ""}`}
      </div>
      </div>
      {/*
        操作区是**右列**，与「标题 + 描述」这一整列垂直居中对齐。
        它以前嵌在 cardHead 内部，于是只能跟标题那一行居中——而卡片有两行，
        结果就是偏上，与宿主设置页的分组行（左标题右控件、整行居中）不一致。
      */}
      {pending ? (
        <span className="smp-cardActions" key="pending">
          <span className="smp-pending" key="p">
            <span className="smp-spinner" key="s" />
            {pendingText}
          </span>
        </span>
      ) : rowOpsReady ? (
        <span className="smp-cardActions" key="actions">
          {enabledSwitch(row)}
          {moreMenu(row, menuItems)}
        </span>
      ) : null}
    </div>
      {rowOpen ? (
        <div className="smp-cardDetails" key="details">
          <div className="smp-details" key="grid">{detailNodes(rowDetailPairs(row))}</div>
          {toolListNode(toolsForServer(serverTools, row.serverName, serverToolsError), `tools-${row.entryId}`, {
            ...filterFor(row.serverName),
            leafOf: leafOf(row.serverName),
            onMode: (mode) => {
              // Entering a mode with nothing selected would leave the server
              // either fully open (`allow`) or untouched (`deny`); the Host
              // treats an empty allow rule as "not configured" for that reason.
              const current = filterFor(row.serverName)
              void writeFilter(row.serverName, { mode, tools: current.tools })
            },
            onToggle: (leaf, checked) => {
              const current = filterFor(row.serverName)
              const next = checked
                ? [...new Set([...current.tools, leaf])]
                : current.tools.filter((name) => name !== leaf)
              void writeFilter(row.serverName, { mode: current.mode, tools: next })
            },
          })}
          {/* Filtering that silently is not running must say so: "off" and
              "could not be installed" look identical in the UI otherwise, and
              only one of them is the user's own configuration. */}
          {filterState.installed !== true ? (
            <p className="smp-note" key="filterOff" style={{ marginTop: 6 }}>
              {`工具过滤当前未生效${filterState.reason ? `：${filterState.reason}` : ''}——勾选会被保存，但要等它可用后才会真正挡住工具。`}
            </p>
          ) : null}
          {/* 「需要授权」必须给出下一步做什么。只标一个标签会让人以为服务器坏了，
              而这恰恰是这个状态要避免的误解——它不是故障，是一次等待用户完成的授权。
              用这张卡片自己的 tier/scope：合并成一个列表后，全局行与项目行都可能
              出现「需要授权」，写死 'global' 会让项目行永远取不到自己的那条状态。 */}
          {needsAuthNote(row.serverName, tier, rowStatusScope)}
          {/* A tool already in the registry cannot be unregistered by this
              plugin, so a rule turned on now only takes full effect once the
              server re-registers its tools. The concrete way to force that is
              this card's own 停用/启用: disabling disposes the mcp-client fiber,
              which unregisters its tools, and enabling re-mounts it and re-runs
              `syncTools` — every tool goes back through the shadow. Saying *how*
              is the difference between a feature and a silent no-op. */}
          {filterState.installed === true && filterFor(row.serverName).mode !== 'off' ? (
            <p className="smp-note" key="filterSync" style={{ marginTop: 6 }}>
              改动会在该服务器重新注册工具时完全生效。想立刻看到效果：把这张卡片「停用」再「启用」（几秒即可），或重启 DSH——插件无法注销别的插件已经注册的工具，而「停用」会连带注销它的工具。
            </p>
          ) : null}
          {filterState.installed === true && Array.isArray(filterState.preExisting) && filterState.preExisting.length > 0 ? (
            <p className="smp-note" key="filterLate" style={{ marginTop: 6 }}>
              {`有 ${filterState.preExisting.length} 个 MCP 工具在过滤生效前就已注册，它们无法再被挡下（重启 DSH 后会彻底生效）。`}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
