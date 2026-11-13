import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { useStore } from "../../../../../client/ui/store.js";
import { ARCH_NS } from "../../locale.js";

export const NAME = "session-menu";

/**
 * The row menu entry for an archived Session.
 *
 * Rendered by the host through `sidebar.workspaces.session.menu.item`, outside the
 * settings panel subtree — which is why this module's CSS is installed globally in
 * `apply` instead of next to this component.
 */
export function install(ctx, host) {
  const t = ctx.locale.bind(ARCH_NS);
  const MenuItem = primitives.MenuItemButton;

  function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, useWorkspaces }) {
    const [, setMenuOpen] = useMenuOpenState();
    const archived = useWorkspaces((snapshot) => snapshot.archivedSessionIds.includes(sessionId));
    const state = useStore(host.removal);
    if (!archived || state.removed.has(sessionId) || !MenuItem) return null;
    const Icon = primitives.IconTrashOutlineRegular;
    return <MenuItem danger disabled={state.busy}
      icon={Icon ? <Icon size={14} /> : undefined}
      onSelect={() => {
        host.removal.request({ id: sessionId, title: displayTitle });
        setMenuOpen(false);
      }}>{t("removeSession")}</MenuItem>;
  }

  return installSlot(ctx, {
    name: "sidebar.workspaces.session.menu.item",
    id: "dsh-toolkit.archived.delete",
    order: 500,
  }, DeleteSessionMenuItem);
}
