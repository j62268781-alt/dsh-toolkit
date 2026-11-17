import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { CardSection, PageHeader } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { Chevron } from "../../../../../client/ui/components/chevron/index.jsx";
import { Tag } from "../../../../../client/ui/components/tag/index.jsx";
import { settingsStyles } from "../../../../../client/styles/settings.js";
import { toast } from "../../../../../client/ui/toast.js";
import panelCss from "./style.css";
import { HOOK_EVENTS, HOOKS_REFRESH_PATH, HOOKS_SNAPSHOT_PATH } from "../../constants.js";
import type { HookEventDefinition } from "../../constants.js";
import { HOOKS_NS } from "../../locale.js";
import type { HookSnapshotView, HookRow, HookRunRow } from "../../model.js";
import { formatDuration, groupHooks, matcherLabel, readSnapshot, runProblem } from "../../model.js";

export const NAME = "settings";

// 只服务本面板：样式随组件走宿主自管的 <style>，模块卸载时宿主一并清理。
const CSS = `${settingsStyles("sk")}\n${panelCss}`;

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
    const [busy, setBusy] = React.useState(false);
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const [showAllHistory, setShowAllHistory] = React.useState(false);
    // 读成功过就置位：切回窗口会重读一次，读失败不该每切一次就弹一条同样的 toast。
    const everLoaded = React.useRef(false);

    const report = React.useCallback((reason: unknown, announce: boolean) => {
      if (!announce && everLoaded.current) return;
      toast.error(t("error", { reason: String((reason as any)?.message ?? reason) }));
    }, []);

    const load = React.useCallback(async (announce: boolean) => {
      if (announce) setBusy(true);
      try {
        const response = await fetchJson(HOOKS_SNAPSHOT_PATH);
        const body = await response.json();
        setSnapshot(readSnapshot(body));
        everLoaded.current = true;
      } catch (reason) {
        report(reason, announce);
      } finally {
        setLoaded(true);
        if (announce) setBusy(false);
      }
    }, [report]);

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
      try {
        await fetchJson(HOOKS_REFRESH_PATH, { json: {} });
        const response = await fetchJson(HOOKS_SNAPSHOT_PATH);
        setSnapshot(readSnapshot(await response.json()));
        everLoaded.current = true;
        // 点刷新后页面上只有数字在变，用户分不清「读到了」还是「按了没反应」。
        toast.success(t("refreshed"));
      } catch (reason) {
        report(reason, true);
      } finally {
        setBusy(false);
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

    const renderHook = (hook: HookRow) => (
      // 子条目不再有自己的标题与展开开关：一条钩子就只有这五行参数，
      // 再包一层「点开看」只是多一次点击，信息量并没有变多。
      <li className="sk-hooks__hook" key={hook.id}>
        <dl className="sk-hooks__fields">
          <dt>{t("fieldType")}</dt>
          <dd>command</dd>
          <dt>{t("fieldCommand")}</dt>
          <dd><code className="sk-hooks__code">{hook.command}</code></dd>
          <dt>{t("fieldTimeout")}</dt>
          <dd>{Math.round(hook.timeoutMs / 1000)}</dd>
          <dt>{t("fieldMatcher")}</dt>
          <dd><code className="sk-hooks__code">{matcherLabel(hook.matcher, t("matcherAll"))}</code></dd>
          <dt>{t("fieldSource")}</dt>
          <dd className="sk-hooks__sourcePath">{hook.sourcePath}</dd>
        </dl>
        {!hook.supported ? <p className="sk-hooks__hint">{t("unsupportedHint")}</p> : null}
      </li>
    );

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
                <Tag>{hooks.length}</Tag>
              </span>
              {event.hint !== "" ? <span className="sk-hooks__rowHint">{event.hint}</span> : null}
            </span>
            <Chevron open={open} />
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
      const eventLabel = HOOK_EVENTS.find((event) => event.id === run.event)?.label ?? run.event;
      return (
        <div className="sk-hooks__run" key={run.id}>
          <div className="sk-hooks__runText">
            <code className="sk-hooks__runCommand" title={run.command}>{run.command}</code>
            <div className="sk-hooks__runHint">
              <span className="sk-hooks__runTime">{run.at > 0 ? timeFormat.format(new Date(run.at)) : "—"}</span>
              <span className="sk-hooks__dot" aria-hidden="true" />
              <span>{eventLabel}</span>
              <span className="sk-hooks__dot" aria-hidden="true" />
              <span className={`sk-hooks__badge sk-hooks__badge--${run.source}`}>{sourceLabel(run.source)}</span>
              {problem.text === "" ? null : (
                <>
                  <span className="sk-hooks__dot" aria-hidden="true" />
                  <span className={`sk-hooks__runNote is-${problem.tone}`} title={problem.text}>{problem.text}</span>
                </>
              )}
            </div>
          </div>
          <div className="sk-hooks__runSide">
            <span className={`sk-hooks__decision is-${run.decision}`}>{t(decisionKeys[run.decision] ?? "decisionAllow")}</span>
            <span className="sk-hooks__runMs">{formatDuration(run.durationMs)}</span>
          </div>
        </div>
      );
    };

    return (
      <div className="sk-hooks">
        <style>{CSS}</style>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />

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

        <CardSection
          className="sk-hooks__group"
          title={(
            <span className="sk-hooks__groupTitle">
              {t("eventsTitle")}
              <Tag>{total}</Tag>
            </span>
          )}
          aria-label={t("eventsTitle")}
          hint={(
            <ActionButton busy={busy} onClick={refresh}>
              {busy ? t("refreshing") : t("refresh")}
            </ActionButton>
          )}
        >
          {rows.map((row) => renderRow(row.event, row.hooks, row.event.id))}
        </CardSection>
        {otherRows.length > 0 ? (
          <CardSection className="sk-hooks__group" title={t("otherEventsTitle")} aria-label={t("otherEventsTitle")}>
            {otherRows.map((row) => renderRow(row.event, row.hooks, row.event.id))}
          </CardSection>
        ) : null}

        <CardSection
          className="sk-hooks__group"
          title={t("historyTitle")}
          aria-label={t("historyTitle")}
          bare={snapshot.history.length === 0}
          hint={snapshot.history.length > 8 && !showAllHistory ? (
            <button type="button" className="sk-hooks__link" onClick={() => setShowAllHistory(true)}>
              {t("showMore")}
            </button>
          ) : undefined}
        >
          {snapshot.history.length === 0
            ? <p className="sk-hooks__hint">{t("historyEmpty")}</p>
            : history.map(renderHistoryRow)}
        </CardSection>
      </div>
    );
  };
}

export function install(ctx: any) {
  const t = ctx.locale.bind(HOOKS_NS);
  return installSlot(ctx, {
    name: "settings.section",
    id: "hooks",
    order: 23,
    label: () => t("nav"),
    locale: HOOKS_NS,
  }, createHooksSection(ctx));
}
