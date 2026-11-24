import React from "react";
import { acceptConfigWrite } from "../../../../../client/config-write.js";
import { fetchJson } from "../../../../../client/http.js";
import { CardSection, Row } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { SettingsSwitch } from "../../../../../client/ui/components/settings-parts/switch.jsx";
import { WORKTREE_CONFIG_PATH } from "../../../host/constants.js";

type Copy = (key: string) => string;
interface NativeConfig { directory: string; namePrefix: string }
const fields = ["directory", "namePrefix"] as const;
type Field = typeof fields[number];

export function WorktreeSettings({ t, retainForm }: { t: Copy; retainForm?: any }) {
  const saved = React.useRef<NativeConfig | undefined>(undefined);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const conflicted = React.useRef(false);
  const [draft, setDraft] = React.useState<NativeConfig>();
  const [status, setStatus] = React.useState("worktreeLoading");
  const [messages, setMessages] = React.useState<Partial<Record<Field, string>>>({});
  const [reload, setReload] = React.useState(0);
  const [retainBusy, setRetainBusy] = React.useState(false);
  const [retainMessage, setRetainMessage] = React.useState("");
  const [, redraw] = React.useState(0);
  const id = React.useId();

  React.useEffect(() => retainForm?.subscribe?.(() => redraw((v) => v + 1)), [retainForm]);
  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchJson(WORKTREE_CONFIG_PATH, { signal: controller.signal });
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok && payload.ok === true) {
          const value = { directory: payload.directory, namePrefix: payload.namePrefix };
          saved.current = value;
          conflicted.current = false;
          setDraft(value);
          setMessages({});
          setStatus("");
        } else setStatus(response.status === 404 ? "worktreeConfigUnavailable" : "worktreeLoadFailed");
      } catch {
        if (!controller.signal.aborted) setStatus("worktreeLoadFailed");
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const message = (field: Field, value: string) => setMessages(previous => ({ ...previous, [field]: value }));
  const save = (field: Field, value: string) => {
    // Both fields share one CAS snapshot. Write only the field that lost focus,
    // and let the next queued write use the snapshot returned by this one.
    queue.current = queue.current.then(async () => {
      const expected = saved.current;
      if (!expected || conflicted.current || expected[field] === value) return;
      message(field, "saving");
      try {
        const response = await fetchJson(WORKTREE_CONFIG_PATH, { json: { expected, ...expected, [field]: value } });
        const payload = await response.json();
        if (response.ok && payload.ok === true) {
          const next = { directory: payload.directory, namePrefix: payload.namePrefix };
          saved.current = next;
          setDraft(current => current?.[field] === value ? { ...current, [field]: next[field] } : current);
          message(field, "saved");
        } else if (response.status === 409) {
          conflicted.current = true;
          message(field, "");
          setStatus("worktreeConfigConflict");
        } else message(field, response.status === 400 ? "worktreeConfigInvalid" : "worktreeSaveFailed");
      } catch {
        message(field, "worktreeSaveFailed");
      }
    });
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

  return <CardSection className="sk-repo-settings__groupLead" title={t("worktreeSettings")} aria-label={t("worktreeSettings")}>
    {draft && fields.map(field => {
      const error = messages[field] === "worktreeConfigInvalid" || messages[field] === "worktreeSaveFailed";
      return <Row key={field}
        title={<label htmlFor={`${id}-${field}`}>{t(`worktree-${field}`)}</label>}
        description={<span id={`${id}-${field}-help`}>{t(`worktree-${field}-help`)}
          {field === "directory" ? <> {t("worktreeConfigWarning")}</> : null}</span>}
        control={<div className="sk-repo-settings__field">
          <input id={`${id}-${field}`} name={field} className="sk-repo-settings__input" value={draft[field]}
            aria-describedby={`${id}-${field}-help ${id}-${field}-status`} aria-invalid={messages[field] === "worktreeConfigInvalid"}
            required={field === "directory"} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            disabled={status !== ""}
            onChange={event => {
              const value = event.currentTarget.value;
              setDraft(previous => previous && { ...previous, [field]: value });
              message(field, "");
            }} onBlur={event => save(field, event.currentTarget.value)} />
          <span id={`${id}-${field}-status`} role="status" className={`sk-repo-settings__hint${error ? " sk-repo-settings__hint--error" : ""}`}>
            {messages[field] && t(messages[field])}
          </span>
        </div>} />;
    })}
    {status && <Row title={<span role="status">{t(status)}</span>} control={
      (status === "worktreeConfigConflict" || status === "worktreeLoadFailed") &&
      <button className="sk-worktrees__button" type="button" onClick={() => {
        setStatus("worktreeLoading");
        setReload(value => value + 1);
      }}>{t("worktreeReload")}</button>
    } />}
    {typeof retained === "boolean" && <Row title={t("worktreeRetain")}
      description={<span id={`${id}-retain-help`}>{t("worktreeRetainHelp")}</span>}
      control={<div className="sk-worktrees__actions">
        <span role="status" className="sk-repo-settings__hint">{retainMessage && t(retainMessage)}</span>
        <SettingsSwitch label={t("worktreeRetain")} describedBy={`${id}-retain-help`}
          checked={retained} disabled={!retainWritable || retainBusy} onChange={checked => void toggleRetention(checked)} />
      </div>} />}
  </CardSection>;
}
