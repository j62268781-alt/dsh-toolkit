import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { MANAGED_WORKTREE_SNAPSHOTS_PATH } from "../../../host/constants.js";

interface Props {
  entry: { sessionId: string; repositoryRoot: string; path: string; branch: string };
  disabled: boolean;
  t: (key: string) => string;
}

const restoreErrors = new Map([
  ["invalid-branch", "restoreInvalidBranch"],
  ["branch-in-use", "restoreBranchInUse"],
  ["snapshot-unavailable", "snapshotUnavailable"],
  ["restore-not-writable", "restoreNotWritable"],
]);

export function SnapshotRecovery({ entry, disabled, t }: Props) {
  const id = React.useId();
  const request = React.useRef<AbortController | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [commits, setCommits] = React.useState<string[] | null>(null);
  const [commit, setCommit] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [created, setCreated] = React.useState("");
  const { sessionId, repositoryRoot, path } = entry;
  const url = `${MANAGED_WORKTREE_SNAPSHOTS_PATH}?${new URLSearchParams({ sessionId, repositoryRoot, path })}`;
  React.useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function run(restore: boolean) {
    if (disabled || request.current || (restore && (!commits?.includes(commit) || !branch))) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice("");
    setCreated("");
    if (!restore) setCommits(null);
    let message = restore ? "restoreUnconfirmed" : "snapshotReadFailed";
    try {
      const response = await fetchJson(url, {
        signal: controller.signal, timeoutMs: 22_000, ...(restore ? { json: { branch, commit } } : {}),
      });
      const payload = await response.json();
      if (request.current !== controller) return;
      if (restore) {
        if (response.ok && payload?.ok === true && payload.branch === branch && payload.commit === commit) {
          setCreated(branch);
          message = "restoreSucceeded";
        } else message = restoreErrors.get(payload?.reason) ?? message;
      } else if (response.ok && payload?.ok === true && Array.isArray(payload.commits)
        && payload.commits.every((value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))) {
        const listed: string[] = payload.commits;
        setCommits(listed);
        setCommit(previous => listed.includes(previous) ? previous : listed[0] ?? "");
        message = listed.length ? "" : "snapshotEmpty";
      }
    } catch {
      // A lost response is not proof that Git didn't create the branch.
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        setNotice(message);
      }
    }
  }

  return <div className="sk-worktrees__recovery">
    <div className="sk-worktrees__actions">
      <button className="sk-worktrees__button" type="button" aria-disabled={disabled || busy}
        aria-label={`${t("snapshotLoad")}: ${entry.branch} (${path})`} onClick={() => void run(false)}>{t("snapshotLoad")}</button>
      {busy && <span className="sk-repo-settings__hint">{t("snapshotWorking")}</span>}
    </div>
    {!!commits?.length && <form className="sk-worktrees__recovery" aria-label={t("restoreCreate")}
      onSubmit={event => { event.preventDefault(); void run(true); }}>
      <p id={`${id}-help`} className="sk-repo-settings__hint">{t("restoreHelp")}</p>
      <label htmlFor={`${id}-commit`}>{t("snapshotCommit")}</label>
      <select className="sk-repo-settings__input" id={`${id}-commit`} value={commit} disabled={disabled || busy} onChange={event => setCommit(event.currentTarget.value)}>
        {commits.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <label htmlFor={`${id}-branch`}>{t("restoreBranch")}</label>
      <input className="sk-repo-settings__input" id={`${id}-branch`} type="text" required maxLength={200} autoComplete="off" spellCheck={false}
        aria-describedby={`${id}-help`} value={branch} readOnly={disabled || busy} onChange={event => setBranch(event.currentTarget.value)} />
      <div><button className="sk-worktrees__button" type="submit" disabled={disabled || busy}>{t("restoreCreate")}</button></div>
    </form>}
    <span role="status" className="sk-worktrees__check-status">
      {notice && <span className="sk-repo-settings__hint">{t(notice)}{created && <> <code>{created}</code></>}</span>}
    </span>
  </div>;
}
