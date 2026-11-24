import { installSlot } from "../../../../../client/ui/slot.js";
import { PageHeader } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { settingsStyles } from "../../../../../client/styles/settings.js";
import { WORKTREES_NS } from "../../locale.js";
import { WorktreeSettings } from "./config.jsx";
import { ManagedWorktrees } from "./managed.jsx";
import repositoryCss from "../../../../../client/ui/components/settings-parts/repository.css";
import panelCss from "./style.css";

const CSS = `${settingsStyles("sk")}\n${repositoryCss}\n${panelCss}`;

export function install(ctx: any) {
  const t = ctx.locale.bind(WORKTREES_NS);
  function WorktreesSection({ retainForm, close }: { retainForm?: any; close?: () => void }) {
    const workspace = ctx.get?.("uiWorkspace");
    const openSession = typeof workspace?.openSession === "function" && typeof close === "function"
      ? (id: string) => { workspace.openSession(id); close(); }
      : undefined;
    return <main className="sk-worktrees sk-repo-settings">
      <style>{CSS}</style>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <WorktreeSettings t={t} retainForm={retainForm} />
      <ManagedWorktrees t={t} openSession={openSession} />
    </main>;
  }
  return installSlot(ctx, {
    name: "settings.section",
    id: "worktrees",
    order: 25,
    label: () => t("title"),
    locale: WORKTREES_NS,
    inject: () => {
      try { return { retainForm: ctx.configForms.get("worktree") }; }
      catch { return {}; } // The native feature is optional.
    },
  }, WorktreesSection);
}
