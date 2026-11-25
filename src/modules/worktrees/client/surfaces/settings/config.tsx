import React from "react";
import { acceptConfigWrite } from "../../../../../client/config-write.js";
import { fetchJson } from "../../../../../client/http.js";
import { CardSection, Row } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { SettingsSwitch } from "../../../../../client/ui/components/settings-parts/switch.jsx";
import { WORKTREE_CONFIG_PATH } from "../../../host/constants.js";

type Copy = (key: string) => string;
interface NativeConfig { directory: string; namePrefix: string; worktreePrefix?: string }
const fields = ["directory", "namePrefix"] as const;
type Field = typeof fields[number];

function nativeConfig({ directory, namePrefix, worktreePrefix }: NativeConfig): NativeConfig {
  return { directory, namePrefix, ...(typeof worktreePrefix === "string" ? { worktreePrefix } : {}) };
}

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
          const value = nativeConfig(payload);
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
  const requireReload = (field: Field, reason: string) => {
    conflicted.current = true;
    message(field, "");
    setStatus(reason);
  };
  const save = (field: Field, value: string, align = false) => {
    // Both fields share one CAS snapshot. Write only the field that lost focus,
    // and let the next queued write use the snapshot returned by this one.
    queue.current = queue.current.then(async () => {
      const expected = saved.current;
      if (!expected || conflicted.current) return;
      const syncNamePrefix = field === "namePrefix" && expected.worktreePrefix !== undefined;
      if (expected[field] === value && (!align || !syncNamePrefix || expected.worktreePrefix === value)) return;
      message(field, "saving");
      try {
        const { directory, namePrefix } = expected;
        const response = await fetchJson(WORKTREE_CONFIG_PATH, { json: {
          expected, directory, namePrefix, [field]: value, ...(syncNamePrefix ? { syncNamePrefix: true } : {}),
        } });
        const payload = await response.json();
        if (response.ok && payload.ok === true) {
          const next = nativeConfig(payload);
          if (syncNamePrefix && (next.namePrefix !== value || next.worktreePrefix !== value)) {
            requireReload(field, "worktreePrefixUnconfirmed");
            return;
          }
          saved.current = next;
          setDraft(current => current && {
            ...current, worktreePrefix: next.worktreePrefix,
            [field]: current[field] === value ? next[field] : current[field],
          });
          message(field, "saved");
        } else if (response.status === 409) {
          requireReload(field, payload.reason === "worktree-prefix-unconfirmed" ? "worktreePrefixUnconfirmed" : "worktreeConfigConflict");
        } else message(field, response.status === 400 ? "worktreeConfigInvalid" : "worktreeSaveFailed");
      } catch {
        if (syncNamePrefix) requireReload(field, "worktreePrefixUnconfirmed");
        else message(field, "worktreeSaveFailed");
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
      const composerPrefix = field === "namePrefix" ? draft.worktreePrefix : undefined;
      const diverged = composerPrefix !== undefined && composerPrefix !== saved.current?.namePrefix;
      return <Row key={field}
        title={<label htmlFor={`${id}-${field}`}>{t(`worktree-${field}`)}</label>}
        description={<span id={`${id}-${field}-help`}>{field === "namePrefix" && composerPrefix === undefined
          ? t("worktreePrefixToolOnly") : t(`worktree-${field}-help`)}
          {field === "directory" && <> {t("worktreeConfigWarning")}</>}
          {diverged && <> {t("worktreePrefixComposerCurrent")} <bdi>{composerPrefix || t("worktreePrefixNone")}</bdi></>}
        </span>}
        control={<div className="sk-repo-settings__field">
          <input id={`${id}-${field}`} name={field} className="sk-repo-settings__input" value={draft[field]}
            aria-describedby={`${id}-${field}-help ${id}-${field}-status`} aria-invalid={messages[field] === "worktreeConfigInvalid"}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            disabled={status !== ""}
            onChange={event => {
              const value = event.currentTarget.value;
              setDraft(previous => previous && { ...previous, [field]: value });
              message(field, "");
            }} onBlur={event => save(field, event.currentTarget.value)} />
          {diverged && draft.namePrefix === saved.current?.namePrefix && <button type="button" className="sk-worktrees__button"
            disabled={status !== "" || messages[field] === "saving"}
            onClick={() => save("namePrefix", draft.namePrefix, true)}>{t("worktreePrefixAlign")}</button>}
          <span id={`${id}-${field}-status`} role="status" className={`sk-repo-settings__hint${error ? " sk-repo-settings__hint--error" : ""}`}>
            {messages[field] && t(messages[field])}
          </span>
        </div>} />;
    })}
    {status && <Row title={<span role="status">{t(status)}</span>} control={
      (status === "worktreeConfigConflict" || status === "worktreePrefixUnconfirmed" || status === "worktreeLoadFailed") &&
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
