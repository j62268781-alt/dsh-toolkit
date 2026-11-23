import React from "react";
import { acceptConfigWrite } from "../../../../../client/config-write.js";
import { fetchJson } from "../../../../../client/http.js";
import { CardSection, Row } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { GIT_WORKTREE_CONFIG_PATH } from "../../constants.js";

type Copy = (key: string) => string;
interface NativeConfig { directory: string; namePrefix: string }

export function WorktreeSettings({ t, retainForm }: { t: Copy; retainForm?: any }) {
  const [state, setState] = React.useState<NativeConfig>();
  const [draft, setDraft] = React.useState<NativeConfig>();
  const [status, setStatus] = React.useState("worktreeLoading");
  const [reload, setReload] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [retainBusy, setRetainBusy] = React.useState(false);
  const [retainMessage, setRetainMessage] = React.useState("");
  const [, redraw] = React.useState(0);
  const id = React.useId();

  React.useEffect(() => retainForm?.subscribe?.(() => redraw((v) => v + 1)), [retainForm]);
  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchJson(GIT_WORKTREE_CONFIG_PATH, { signal: controller.signal });
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok && payload.ok === true) {
          const value = { directory: payload.directory, namePrefix: payload.namePrefix };
          setState(value);
          setDraft(value);
          setStatus("");
        } else setStatus(response.status === 404 ? "worktreeConfigUnavailable" : "worktreeLoadFailed");
      } catch {
        if (!controller.signal.aborted) setStatus("worktreeLoadFailed");
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state || !draft || saving) return;
    setStatus("saving");
    setSaving(true);
    try {
      const response = await fetchJson(GIT_WORKTREE_CONFIG_PATH, { json: { expected: state, ...draft } });
      const payload = await response.json();
      if (response.ok && payload.ok === true) {
        const value = { directory: payload.directory, namePrefix: payload.namePrefix };
        setDraft(value);
        setState(value);
        setStatus("saved");
      } else if (response.status === 409) setStatus("worktreeConfigConflict");
      else if (response.status === 400) setStatus("worktreeConfigInvalid");
      else setStatus("worktreeSaveFailed");
    } catch {
      setStatus("worktreeSaveFailed");
    } finally {
      setSaving(false);
    }
  };

  const snapshot = retainForm?.getSnapshot?.();
  const retained = (snapshot?.value ?? snapshot)?.retainOnArchive;
  const retainWritable = typeof retained === "boolean" && typeof retainForm?.set === "function"
    && snapshot?.writable !== false && retainForm?.writable !== false && snapshot?.status !== "loading";
  const toggleRetention = async (checked: boolean) => {
    if (!retainWritable || retainBusy) return;
    setRetainBusy(true);
    setRetainMessage("saving");
    try {
      await acceptConfigWrite(() => retainForm.set("retainOnArchive", checked), "retainOnArchive");
      setRetainMessage("saved");
    } catch {
      setRetainMessage("worktreeSaveFailed");
    } finally {
      setRetainBusy(false);
    }
  };

  return <CardSection title={t("worktreeSettings")}>
    <Row title={<label htmlFor={`${id}-retain`}>{t("worktreeRetain")}</label>}
      description={<span id={`${id}-retain-help`}>{t("worktreeRetainHelp")}</span>}
      control={typeof retained === "boolean" ? <input id={`${id}-retain`} type="checkbox"
        aria-describedby={`${id}-retain-help`} checked={retained} disabled={!retainWritable || retainBusy}
        onChange={(event) => void toggleRetention(event.currentTarget.checked)} /> : <span>{t("worktreeConfigUnavailable")}</span>} />
    {retainMessage && <p className="sk-ui-row sk-git__hint" role="status">{t(retainMessage)}</p>}
    <form className="sk-ui-row sk-git__stack" aria-label={t("worktreeLocationForm")} onSubmit={save}>
      {draft && ["directory", "namePrefix"].map((field: keyof NativeConfig) => <div key={field} className="sk-git__field">
        <label className="sk-ui-rowTitle" htmlFor={`${id}-${field}`}>{t(`worktree-${field}`)}</label>
        <input id={`${id}-${field}`} name={field} className="sk-git__input" value={draft[field]}
          aria-describedby={`${id}-${field}-help`} required={field === "directory"} spellCheck={false}
          disabled={saving || status === "worktreeConfigConflict"}
          onChange={(event) => { setDraft({ ...draft, [field]: event.currentTarget.value }); setStatus(""); }} />
        <span id={`${id}-${field}-help`} className="sk-git__hint">{t(`worktree-${field}-help`)}</span>
      </div>)}
      {draft && <p className="sk-git__hint">{t("worktreeConfigWarning")}</p>}
      <div className="sk-git__worktreeActions">
        {draft && <button className="sk-git__worktreeButton" type="submit" disabled={saving || status === "worktreeConfigConflict"
          || (draft.directory === state?.directory && draft.namePrefix === state?.namePrefix)}>{t("worktreeSave")}</button>}
        {(status === "worktreeConfigConflict" || status === "worktreeLoadFailed") && <button className="sk-git__worktreeButton" type="button"
          onClick={() => { setStatus("worktreeLoading"); setReload(reload + 1); }}>{t("worktreeReload")}</button>}
        <span role="status" className="sk-git__hint">{status && t(status)}</span>
      </div>
    </form>
  </CardSection>;
}
