import { IMPORT_CHOICES } from '../importSources.js'
import { field } from '../components/field.jsx'
import { importLabel, splitImport, takenNames as takenNamesOf } from '../crud/import.js'

export function importCardView({
  scope, importProject, importScan, profileRows, importOpen, busy, scanPending = false, setImportOpen,
  setImportScope, importSource, setImportSource, importCustomProject,
  setImportCustomProject, setImportProject, projectChoices, onScan, onImport,
}) {
  const target = scope === 'global' ? '' : importProject
  const raw = importScan
  const result = raw !== null && typeof raw === 'object' && raw.scope === scope && raw.source === importSource
    && (scope === 'global' || raw.project === target) ? raw : null
  const needsProject = scope === 'project' && target === ''
  // Import never overwrites: names already managed for this scope are skipped.
  const takenNames = takenNamesOf({ scope, target, profileRows })
  const { fresh: freshServers, skipped: skippedServers } = splitImport(result?.servers ?? [], takenNames)
  if (!importOpen) {
    return (
      <li className="smp-card" key="import">
        <div className="smp-cardHead" key="head">
          <span className="smp-cardIdentity" key="t">{scope === "global" ? "导入 MCP" : "导入 MCP"}</span>
          <span className="smp-cardActions" key="a">
            <button
              className="smp-button" data-variant="outline" key="go" disabled={busy}
              onClick={() => setImportOpen(true)}
            >
              选择来源
            </button>
          </span>
        </div>
        <div className="smp-cardDescription" key="d">
          {scope === "global"
            ? "从其他编辑器/CLI 的用户级配置文件导入（写成配置文件行）。"
            : "从其他编辑器/CLI 的项目级文件导入到面板的项目条目。"}
        </div>
      </li>
    )
  }
  return (
    <li className="smp-card" key="import">
      <div className="smp-cardHead" key="head">
        <span className="smp-cardIdentity" key="t">{scope === "global" ? "导入全局 MCP" : "导入项目 MCP"}</span>
        <span className="smp-cardActions" key="a">
          <button className="smp-button" data-variant="outline" key="close" onClick={() => setImportOpen(false)}>收起</button>
        </span>
      </div>
      <div className="smp-segment" key="segment">
        <button key="g" data-active={String(scope === "global")} onClick={() => setImportScope("global")}>全局</button>
        <button key="p" data-active={String(scope === "project")} onClick={() => setImportScope("project")}>项目级</button>
      </div>
      <div className="smp-formGrid" key="grid">
        {field("来源", (
          <select className="smp-select" value={importSource} onChange={(event) => setImportSource(event.target.value)}>
            {IMPORT_CHOICES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
          </select>
        ))}
        {scope === "global" ? null : importCustomProject ? field("项目路径", (
          <div className="smp-actionsRow" style={{ marginTop: 0 }}>
            <input
              className="smp-input" placeholder="项目绝对路径" style={{ flex: "1 1 auto" }}
              value={importProject} onChange={(event) => setImportProject(event.target.value)}
            />
            <button className="smp-button" data-variant="outline" key="back" onClick={() => setImportCustomProject(false)}>选工作区</button>
          </div>
        )) : field("项目", (
          <div className="smp-actionsRow" style={{ marginTop: 0 }}>
            <select
              className="smp-select" value={importProject} style={{ flex: "1 1 auto" }}
              onChange={(event) => {
                if (event.target.value === "__custom__") { setImportCustomProject(true); return }
                setImportProject(event.target.value)
              }}
            >
              <option value="" key="none">选择一个工作区…</option>
              {projectChoices.map(([path, title]) => <option value={path} key={path}>{title}</option>)}
              <option value="__custom__" key="custom">自定义路径…</option>
            </select>
            {importProject !== "" ? (
              <button className="smp-button" data-variant="outline" key="clear" onClick={() => setImportProject("")}>清除</button>
            ) : null}
          </div>
        ))}
      </div>
      {needsProject ? (
        <div className="smp-cardDescription" key="need">先选择一个工作区（或切到「全局」读用户级配置）。</div>
      ) : result === null ? (
        <div className="smp-cardDescription" key="hint">点「扫描」后，会把该工具在项目里的 MCP 文件与能导入的条目列出来。</div>
      ) : (
        <div key="result">
          {result.files.map((file) => (
            <div className="smp-cardDescription" key={file.path}>
              {`${file.exists ? "✓" : "✗"} ${file.path}${file.exists ? ` · 识别 ${file.servers.length} 个${file.unsupported > 0 ? `（${file.unsupported} 个形态不支持）` : ""}` : " · 文件不存在"}${file.error !== null && file.error !== "" ? ` · ${file.error}` : ""}`}
            </div>
          ))}
          {result.error !== null && result.error !== "" ? <div className="smp-error" key="err">{result.error}</div> : null}
          <div className="smp-cardDescription" key="sum">
            {`新增 ${freshServers.length} 个：${freshServers.map((server) => server.serverName).join("、") || "—"}`}
          </div>
          {skippedServers.length > 0 ? (
            <div className="smp-cardDescription" key="skip">
              {`已存在 ${skippedServers.length} 个（跳过，不覆盖）：${skippedServers.map((server) => server.serverName).join("、")}`}
            </div>
          ) : null}
        </div>
      )}
      <div className="smp-actionsRow" key="actions">
        <button
          className="smp-button" data-variant="primary" key="scan"
          disabled={busy || scanPending || (scope === "project" && target === "")}
          onClick={() => onScan({ source: importSource, scope, project: target })}
        >
          扫描
        </button>
        {result !== null && freshServers.length > 0 ? (
          <button
            className="smp-button" data-variant="outline" key="do"
            onClick={() => onImport({ scope, target, result })}
          >
            {importLabel({ scope, fresh: freshServers.length, skipped: skippedServers.length })}
          </button>
        ) : null}
      </div>
    </li>
  )
}
