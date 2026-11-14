import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { settingsStyles } from "../../../../../client/styles/settings.js";
import panelCss from "./style.css";
import { HOOK_EVENTS, HOOKS_REFRESH_PATH, HOOKS_SNAPSHOT_PATH, HOOKS_TEST_PATH } from "../../constants.js";
import type { HookEventDefinition } from "../../constants.js";
import { HOOKS_NS } from "../../locale.js";
import type { HookSnapshotView, HookRow, HookRunRow } from "../../model.js";
import { formatDuration, groupHooks, matcherLabel, readSnapshot, runProblem } from "../../model.js";

export const NAME = "settings";

// 只服务本面板：样式随组件走宿主自管的 <style>，模块卸载时宿主一并清理。
const CSS = `${settingsStyles("sk")}\n${panelCss}`;

const TEMPLATE = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [{ "type": "command", "command": "echo hello" }]
      }
    ]
  }
}`;

function createHooksSection(ctx: any) {
  const Button = primitives.Button;

  interface ActionButtonProps {
    busy?: boolean;
    disabled?: boolean;
    onClick?: () => any;
    className?: string;
    children?: any;
  }

  function ActionButton({ busy, disabled, onClick, className, children }: ActionButtonProps) {
    if (Button === undefined) {
      return <button type="button" className={className ?? "sk-hooks__btn"} disabled={busy || disabled} onClick={onClick}>{children}</button>;
    }
    return <Button type="button" variant="outline" size="sm" className={className} disabled={busy || disabled} onClick={onClick}>{children}</Button>;
  }

  const decisionKeys: Record<string, string> = {
    allow: "decisionAllow",
    deny: "decisionDeny",
    ask: "decisionAsk",
  };

  return function HooksSection() {
    const t = ctx.locale.bind(HOOKS_NS);
    const [snapshot, setSnapshot] = React.useState<HookSnapshotView>(() => readSnapshot({}));
    const [loaded, setLoaded] = React.useState(false);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const [testingId, setTestingId] = React.useState("");
    const [testResults, setTestResults] = React.useState<Record<string, string>>({});
    const [copiedPath, setCopiedPath] = React.useState("");
    const [showAllHistory, setShowAllHistory] = React.useState(false);

    const load = React.useCallback(async (announce: boolean) => {
      if (announce) setBusy(true);
      try {
        const response = await fetchJson(HOOKS_SNAPSHOT_PATH);
        const body = await response.json();
        setSnapshot(readSnapshot(body));
        setError("");
      } catch (reason) {
        setError(String((reason as any)?.message ?? reason));
      } finally {
        setLoaded(true);
        if (announce) setBusy(false);
      }
    }, []);

    React.useEffect(() => {
      void load(false);
    }, [load]);

    // 改完 hooks.json 切回窗口就能看到新配置，不用记着点刷新。
    React.useEffect(() => {
      const onFocus = () => {
        void load(false);
      };
      try {
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
      } catch {
        return undefined;
      }
    }, [load]);

    const refresh = async () => {
      setBusy(true);
      setError("");
      try {
        await fetchJson(HOOKS_REFRESH_PATH, { json: {} });
        const response = await fetchJson(HOOKS_SNAPSHOT_PATH);
        setSnapshot(readSnapshot(await response.json()));
      } catch (reason) {
        setError(String((reason as any)?.message ?? reason));
      } finally {
        setBusy(false);
      }
    };

    const runTest = async (hook: HookRow) => {
      setTestingId(hook.id);
      setTestResults((current) => ({ ...current, [hook.id]: t("testing") }));
      try {
        const response = await fetchJson(HOOKS_TEST_PATH, { json: { hookId: hook.id } });
        const body = await response.json();
        const result = body?.result ?? {};
        const decision = typeof result?.decision === "string" ? result.decision : "allow";
        const verdict = t(decisionKeys[decision] ?? "decisionAllow");
        const line = t("testDone", { decision: verdict, ms: formatDuration(Number(result?.durationMs) || 0) });
        const detail = typeof result?.error === "string" && result.error !== ""
          ? ` · ${result.error}`
          : typeof result?.reason === "string" && result.reason !== ""
            ? ` · ${result.reason}`
            : "";
        setTestResults((current) => ({ ...current, [hook.id]: `${line}${detail}` }));
        await load(false);
      } catch (reason) {
        setTestResults((current) => ({ ...current, [hook.id]: t("testFailed", { reason: String((reason as any)?.message ?? reason) }) }));
      } finally {
        setTestingId("");
      }
    };

    const copy = async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        setCopiedPath(path);
        setTimeout(() => setCopiedPath(""), 1200);
      } catch {
        setCopiedPath("");
      }
    };

    const groups = groupHooks(snapshot, HOOK_EVENTS);
    const total = snapshot.hooks.length;
    // 五个已接线的事件永远各占一行（没配也列出来，方便照着填配置）；其余事件只在真配了才出现。
    const rows = HOOK_EVENTS.filter((event) => event.supported).map((event) => ({
      event,
      hooks: groups.find((group) => group.event.id === event.id)?.hooks ?? [],
    }));
    const otherRows = groups.filter((group) => !group.event.supported);
    const userFile = snapshot.files.find((file) => file.id === "user");
    const history = showAllHistory ? snapshot.history : snapshot.history.slice(0, 8);
    const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

    const sourceLabel = (source: string) => {
      if (source === "project") return t("sourceProject");
      if (source === "local") return t("sourceLocal");
      return t("sourceUser");
    };

    const issueText = (code: string, message: string) => {
      // 诊断码是 `bad-document` 这种形式，字典里用驼峰键：`issue_code_badDocument`。
      const camel = code.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      const key = `issue_code_${camel}`;
      const translated = t(key);
      return translated === key ? message : `${translated}${message === "" ? "" : `：${message}`}`;
    };

    const toggle = (id: string) => {
      setExpanded((current) => ({ ...current, [id]: !current[id] }));
    };

    const renderHook = (hook: HookRow) => {
      const result = testResults[hook.id];
      return (
        <li className="sk-hooks__hook" key={hook.id}>
          <div className="sk-hooks__hookHead">
            <span className={`sk-hooks__badge sk-hooks__badge--${hook.source}`}>{sourceLabel(hook.source)}</span>
            <code className="sk-hooks__command" title={hook.command}>{hook.command}</code>
            <span className="sk-hooks__meta">
              {hook.supported ? t("timeout", { s: Math.round(hook.timeoutMs / 1000) }) : t("unsupported")}
            </span>
          </div>
          <div className="sk-hooks__hookFoot">
            <span className="sk-hooks__matcher">{matcherLabel(hook.matcher, t("matcherAll"))}</span>
            <span className={`sk-hooks__status ${hook.supported ? "is-supported" : "is-unsupported"}`}>
              {hook.supported ? t("supported") : t("unsupported")}
            </span>
            {hook.supported ? (
              <ActionButton
                busy={testingId === hook.id}
                onClick={() => runTest(hook)}
              >
                {testingId === hook.id ? t("testing") : t("test")}
              </ActionButton>
            ) : null}
            <button
              type="button"
              className="sk-hooks__link"
              onClick={() => copy(hook.sourcePath)}
            >
              {copiedPath === hook.sourcePath ? t("copied") : t("copyPath")}
            </button>
          </div>
          {result ? <p className="sk-hooks__result">{result}</p> : null}
          {!hook.supported ? <p className="sk-hooks__hint">{t("unsupportedHint")}</p> : null}
        </li>
      );
    };

    const renderRow = (event: HookEventDefinition, hooks: HookRow[], key: string) => {
      const open = expanded[key] === true;
      const named = t(`event_${event.id}`);
      const name = named === `event_${event.id}` ? event.label : named;
      return (
        <div className="sk-hooks__row" key={key}>
          <button type="button" className="sk-hooks__rowHead" onClick={() => toggle(key)} aria-expanded={open}>
            <span className="sk-hooks__rowText">
              <span className="sk-hooks__rowTitle">
                {name}
                <span className="sk-hooks__count">{hooks.length}</span>
              </span>
              {event.hint !== "" ? <span className="sk-hooks__rowHint">{event.hint}</span> : null}
            </span>
            <span className={`sk-hooks__chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
          </button>
          {open ? (
            <div className="sk-hooks__rowBody">
              {hooks.length === 0
                ? <p className="sk-hooks__hint">{t("eventEmpty")}</p>
                : <ul className="sk-hooks__hooks">{hooks.map(renderHook)}</ul>}
              {!event.supported ? <p className="sk-hooks__hint">{t("unsupportedHint")}</p> : null}
            </div>
          ) : null}
        </div>
      );
    };

    const renderHistoryRow = (run: HookRunRow) => {
      const problem = runProblem(run, { timedOut: t("timedOut"), exit: (code) => t("exit", { code }) });
      return (
        <li className="sk-hooks__run" key={run.id}>
          <span className="sk-hooks__runTime">{run.at > 0 ? timeFormat.format(new Date(run.at)) : "—"}</span>
          <span className={`sk-hooks__badge sk-hooks__badge--${run.source}`}>{sourceLabel(run.source)}</span>
          <code className="sk-hooks__runCommand" title={run.command}>{run.command}</code>
          <span className={`sk-hooks__decision is-${run.decision}`}>{t(decisionKeys[run.decision] ?? "decisionAllow")}</span>
          {problem.text === "" ? null : (
            <span className={`sk-hooks__runNote is-${problem.tone}`} title={problem.text}>{problem.text}</span>
          )}
          <span className="sk-hooks__runMs">{formatDuration(run.durationMs)}</span>
        </li>
      );
    };

    return (
      <div className="sk-hooks">
        <style>{CSS}</style>
        <div className="sk-hooks__head">
          <div className="sk-hooks__headText">
            <h2 className="sk-hooks__title">{t("title")}</h2>
            <p className="sk-hooks__subtitle">{t("subtitle")}</p>
          </div>
          <ActionButton busy={busy} onClick={refresh}>
            {busy ? t("refreshing") : t("refresh")}
          </ActionButton>
        </div>

        {error !== "" ? <p className="sk-hooks__error">{t("error", { reason: error })}</p> : null}
        {loaded && !snapshot.enabled ? <p className="sk-hooks__notice">{t("disabled")}</p> : null}

        {snapshot.issues.length > 0 ? (
          <div className="sk-hooks__issues">
            <h3 className="sk-hooks__sectionTitle">{t("issuesTitle")} · {snapshot.issues.length}</h3>
            <ul>
              {snapshot.issues.map((issue) => (
                <li className={`sk-hooks__issue is-${issue.severity}`} key={issue.id}>
                  <span className="sk-hooks__issueCode">{issue.event ? `${issue.event} · ` : ""}</span>
                  {issueText(issue.code, issue.message)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <h3 className="sk-hooks__sectionTitle">{t("eventsTitle")} · {total}</h3>
        <div className="sk-hooks__card">
          {rows.map((row) => renderRow(row.event, row.hooks, row.event.id))}
        </div>
        {otherRows.length > 0 ? (
          <div className="sk-hooks__card">
            {otherRows.map((row) => renderRow(row.event, row.hooks, row.event.id))}
          </div>
        ) : null}
        {total === 0 ? (
          <div className="sk-hooks__empty">
            <p className="sk-hooks__emptyTitle">{t("emptyTitle")}</p>
            <p className="sk-hooks__hint">{t("emptyHint")}</p>
            <pre className="sk-hooks__pre">{TEMPLATE}</pre>
            {userFile ? (
              <button type="button" className="sk-hooks__path" onClick={() => copy(userFile.path)}>
                {copiedPath === userFile.path ? t("copied") : userFile.path}
              </button>
            ) : null}
          </div>
        ) : null}

        <h3 className="sk-hooks__sectionTitle">{t("historyTitle")}</h3>
        {snapshot.history.length === 0 ? (
          <p className="sk-hooks__hint">{t("historyEmpty")}</p>
        ) : (
          <div className="sk-hooks__history">
            <ul className="sk-hooks__runs">{history.map(renderHistoryRow)}</ul>
            {snapshot.history.length > 8 && !showAllHistory ? (
              <button type="button" className="sk-hooks__link" onClick={() => setShowAllHistory(true)}>
                {t("showMore")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    );
  };
}

export function install(ctx: any) {
  const t = ctx.locale.bind(HOOKS_NS);
  return installSlot(ctx, {
    name: "settings.section",
    id: "hooks",
    order: 26,
    label: () => t("nav"),
    locale: HOOKS_NS,
  }, createHooksSection(ctx));
}
