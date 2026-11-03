import React from "react";
import { ARCH_NS } from "./locale.js";
import { readArchived } from "./model.js";
import { DeleteButton, useRemoval } from "./removal.jsx";

const primitives = (() => {
  try { return require("@deepseek-ai/dsh-client-ui-primitives"); } catch { return {}; }
})();

const UNGROUPED = "__ungrouped";

function ArchivedFolderIcon() {
  return (
    <svg
      className="sk-arch__icon"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={1}
      aria-hidden="true"
    >
      <path
        d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z"
        stroke="currentColor"
      />
      <path d="M3.63501 7.66614H12.3647" stroke="currentColor" />
    </svg>
  );
}

/** Same geometry as the host `IconSearchOutlineRegular`; only used when primitives are missing. */
function FallbackSearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx={7} cy={7} r={4.5} stroke="currentColor" strokeWidth={1} />
      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

function createArchivedSection(ctx, removal) {
  const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const Button = primitives.Button;
  const SearchIcon = primitives.IconSearchOutlineRegular ?? FallbackSearchIcon;

  function RestoreButton({ busy, disabled, onClick, className, children }) {
    if (Button === undefined) {
      return <button type="button" className={className ?? "sk-arch__btn"} disabled={busy || disabled} onClick={onClick}>{children}</button>;
    }
    return <Button type="button" variant="outline" size="sm" className={className} disabled={busy || disabled} onClick={onClick}>{children}</Button>;
  }

  return function ArchivedChatsSection() {
    const t = ctx.locale.bind(ARCH_NS);
    const [, bump] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const [project, setProject] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");

    const removalState = useRemoval(removal);

    React.useEffect(() => {
      const rerender = () => bump((n) => n + 1);
      const offs = [];
      try {
        offs.push(ctx.sessions.list.subscribe(rerender));
      } catch {}
      try {
        offs.push(ctx.workspaces.list.subscribe(rerender));
      } catch {}
      return () => {
        for (const off of offs) {
          try {
            off();
          } catch {}
        }
      };
    }, []);

    const { groups, total, projects, hasUngrouped } = readArchived(ctx);
    const needle = query.trim().toLowerCase();
    const visible = groups
      .filter((group) => project === "" || group.id === project)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (removalState.removed.has(row.id)) return false;
          if (needle === "") return true;
          return (
            (row.title || "").toLowerCase().includes(needle) ||
            group.title.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);

    const restore = async (id) => {
      setBusy(true);
      setError("");
      try {
        await ctx.workspaces.unarchiveSession(id);
      } catch (reason) {
        setError(String(reason?.message ?? reason));
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="sk-arch">
        <div className="sk-arch__head">
          <div className="sk-arch__headText">
            <h2 className="sk-arch__title">{t("title")}</h2>
            <p className="sk-arch__subtitle">{t("removeHint")}</p>
          </div>
        </div>

        <div className="sk-arch__bar">
          <label className="sk-search">
            <span className="sk-searchIcon"><SearchIcon aria-hidden="true" /></span>
            <input
              className="sk-searchInput"
              type="search"
              value={query}
              placeholder={t("search")}
              aria-label={t("search")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            className="sk-arch__select"
            value={project}
            aria-label={t("project")}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">{t("allProjects")}</option>
            {projects.map((entry) => (
              <option value={entry.id} key={entry.id}>
                {entry.title}
              </option>
            ))}
            {hasUngrouped ? <option value={UNGROUPED}>{t("ungrouped")}</option> : null}
          </select>
          <DeleteButton
            className="sk-arch__removeAll"
            disabled={busy || removalState.busy || total === 0}
            onClick={() => removal.requestAll(groups)}
          >
            {t("removeAll")}
          </DeleteButton>
        </div>

        {error !== "" ? <p role="alert" className="sk-arch__note--error">{t("restoreFailed").replace("{reason}", error)}</p> : null}

        {visible.length === 0 ? (
          <div className="sk-arch__empty">
            <p className="sk-arch__emptyTitle">{total === 0 ? t("empty") : t("noMatch")}</p>
            {total === 0 ? <p className="sk-arch__emptyHint">{t("emptyHint")}</p> : null}
          </div>
        ) : (
          visible.map((group) => (
            <section className="sk-arch__group" key={group.id}>
              <div className="sk-arch__groupHead">
                <ArchivedFolderIcon />
                <span className="sk-arch__groupTitle">{group.title || t("ungrouped")}</span>
                <span className="sk-arch__groupCount">{`${group.rows.length} ${t("chats")}`}</span>
              </div>
              {group.rows.map((row) => (
                <div className="sk-arch__row" key={row.id}>
                  <div className="sk-arch__rowMain">
                    <span className="sk-arch__rowTitle" title={row.missing ? row.id : row.title || t("untitled")}>
                      {row.title || (row.missing ? t("missing") : t("untitled"))}
                    </span>
                    <span className="sk-arch__rowTime">
                      {row.updatedAt > 0 ? timeFormat.format(new Date(row.updatedAt)) : ""}
                    </span>
                  </div>
                  <RestoreButton busy={busy || removalState.busy} onClick={() => { void restore(row.id); }}>
                    {t("restore")}
                  </RestoreButton>
                  <DeleteButton size="sm" disabled={busy || removalState.busy} onClick={() => removal.request(row)}>
                    {t("remove")}
                  </DeleteButton>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    );
  };
}

export function installArchivedSection(ctx, removal) {
  const t = ctx.locale.bind(ARCH_NS);
  return ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "archived-chats",
        order: 20,
        label: () => t("nav"),
        locale: ARCH_NS,
      },
      createArchivedSection(ctx, removal)
    )
  );
}
