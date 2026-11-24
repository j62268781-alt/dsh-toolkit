import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { CardSection } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { MANAGED_WORKTREES_PATH } from "../../../host/constants.js";

interface Entry {
  path: string;
  branch: string;
  repositoryRoot: string;
  status?: "present" | "missing" | "unknown";
  sessionId?: string;
  sessionTitle?: string;
  sessionArchived?: boolean;
}

interface Props {
  t: (key: string) => string;
  openSession?: (id: string) => void;
}

export function ManagedWorktrees({ t, openSession }: Props) {
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [error, setError] = React.useState<"managedUnavailable" | "managedFailed" | null>(null);
  const [openError, setOpenError] = React.useState(false);
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchJson(MANAGED_WORKTREES_PATH, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 404 || response.status === 401 || response.status === 403) setEntries(null);
          setError(response.status === 404 ? "managedUnavailable" : "managedFailed");
          return;
        }
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (payload?.ok === true && Array.isArray(payload.worktrees)) {
          setEntries(payload.worktrees);
          setError(null);
        } else setError("managedFailed");
      } catch {
        if (!controller.signal.aborted) setError("managedFailed");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  const groups = new Map<string, Entry[]>();
  for (const entry of entries ?? []) {
    const group = groups.get(entry.repositoryRoot);
    if (group) group.push(entry);
    else groups.set(entry.repositoryRoot, [entry]);
  }
  const status = loading ? t("worktreeLoading") : openError ? t("originOpenFailed")
    : error ? t(entries ? "managedRefreshFailed" : error) : entries?.length ? "" : t("managedEmpty");
  return <CardSection title={t("managedTitle")} aria-label={t("managedTitle")}>
    <div className="sk-ui-row sk-worktrees__stack">
      <div className="sk-worktrees__actions">
        <button className="sk-worktrees__button" type="button" aria-disabled={loading}
          onClick={() => { if (!loading) { setOpenError(false); setLoading(true); refresh(); } }}>{t("managedRefresh")}</button>
        <span className="sk-repo-settings__hint" role="status">{status}</span>
      </div>
      <p className="sk-repo-settings__hint">{t("managedDescription")}</p>
      {entries?.some(entry => entry.sessionArchived) && <p className="sk-repo-settings__hint">{t("originArchivedHelp")}</p>}
      {[...groups].map(([repository, group]) => <div key={repository}>
        <h4 className="sk-worktrees__repository">{t("repository")}: {repository}</h4>
        <ul role="list" className="sk-worktrees__entries">
          {group.map(entry => {
            const { sessionId, sessionArchived } = entry;
            const sessionLabel = entry.sessionTitle?.trim() || sessionId;
            return <li key={entry.path}>
              <div className="sk-worktrees__actions">
                <div className="sk-ui-rowTitle">{entry.branch}</div>
                <span className="sk-repo-settings__hint">{t(entry.status === "present" ? "checkoutPresent"
                  : entry.status === "missing" ? "checkoutMissing" : "checkoutUnknown")}</span>
              </div>
              <code>{entry.path}</code>
              {sessionId && <div className="sk-worktrees__actions">
                <span className="sk-repo-settings__hint">{t("originSession")}: {sessionLabel}
                  {sessionArchived && ` · ${t("originArchived")}`}</span>
                {sessionArchived === false && openSession && <button className="sk-worktrees__button" type="button"
                  aria-label={`${t("originOpen")}: ${sessionLabel} (${entry.branch})`}
                  onClick={() => { try { openSession(sessionId); } catch { setOpenError(true); } }}>{t("originOpen")}</button>}
              </div>}
            </li>;
          })}
        </ul>
      </div>)}
    </div>
  </CardSection>;
}
