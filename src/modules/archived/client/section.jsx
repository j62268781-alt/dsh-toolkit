import React from "react";
import { ARCH_NS } from "./locale.js";
import { readArchived } from "./model.js";
import { removeSessionViaHost } from "./deletion.js";

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

function ArchivedSearchIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx={7} cy={7} r={4.5} stroke="currentColor" strokeWidth={1} />
      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

function createArchivedSection(ctx) {
  const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return function ArchivedChatsSection() {
    const t = ctx.locale.bind(ARCH_NS);
    const [, bump] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const [project, setProject] = React.useState("");
    const [busy, setBusy] = React.useState(false);

    const [hidden, setHidden] = React.useState(() => new Set());
    const [notice, setNotice] = React.useState("");

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

    const { groups, total, unlisted } = readArchived(ctx);
    const projects = groups.filter((group) => group.id !== "__ungrouped");
    const needle = query.trim().toLowerCase();
    const visible = groups
      .filter((group) => project === "" || group.id === project)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (hidden.has(row.id)) return false;
          if (needle === "") return true;
          return (
            (row.title || "").toLowerCase().includes(needle) ||
            group.title.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);
    const shown = visible.reduce((n, group) => n + group.rows.length, 0);

    const remove = async (row) => {
      const ask = t("confirmRemove").replace("{t}", row.title || t("untitled"));
      if (typeof window !== "undefined" && !window.confirm(ask)) return;
      setBusy(true);
      setNotice("");
      try {
        const result = await removeSessionViaHost(row.id);
        if (result?.ok === true) {
          setHidden((prev) => new Set(prev).add(row.id));
        } else {
          setNotice(t("removeFailed").replace("{reason}", result?.reason ?? "unknown"));
        }
      } finally {
        setBusy(false);
      }
    };

    const restore = async (id) => {
      setBusy(true);
      try {
        await ctx.workspaces.unarchiveSession(id);
      } finally {
        setBusy(false);
      }
    };
    const restoreAll = async () => {
      const ids = visible.flatMap((group) => group.rows.map((row) => row.id));
      if (ids.length === 0) return;
      const ask = t("confirmRestoreAll").replace("{n}", String(ids.length));
      if (typeof window !== "undefined" && !window.confirm(ask)) return;
      setBusy(true);
      try {
        for (const id of ids) await ctx.workspaces.unarchiveSession(id);
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="sk-arch">
        <div className="sk-arch__head">
          <h2 className="sk-arch__title">{t("title")}</h2>
          <button
            type="button"
            className="sk-arch__action"
            disabled={busy || shown === 0}
            onClick={restoreAll}
          >
            {t("restoreAll")}
          </button>
        </div>

        <div className="sk-arch__bar">
          <div className="sk-arch__search">
            <ArchivedSearchIcon />
            <input
              type="search"
              value={query}
              placeholder={t("search")}
              aria-label={t("search")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="sk-arch__select"
            value={project}
            aria-label={t("project")}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">{t("allProjects")}</option>
            {projects.map((group) => (
              <option value={group.id} key={group.id}>
                {group.title}
              </option>
            ))}
          </select>
        </div>

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
                    <span className="sk-arch__rowTitle" title={row.title || t("untitled")}>
                      {row.title || t("untitled")}
                    </span>
                    <span className="sk-arch__rowTime">
                      {row.updatedAt > 0 ? timeFormat.format(new Date(row.updatedAt)) : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sk-arch__btn"
                    disabled={busy}
                    onClick={() => restore(row.id)}
                  >
                    {t("restore")}
                  </button>
                  <button
                    type="button"
                    className="sk-arch__btn sk-arch__btn--danger"
                    disabled={busy}
                    onClick={() => remove(row)}
                  >
                    {t("remove")}
                  </button>
                </div>
              ))}
            </section>
          ))
        )}

        {notice !== "" ? <p className="sk-arch__note sk-arch__note--error">{notice}</p> : null}
        <p className="sk-arch__note">{t("removeHint")}</p>

        {unlisted > 0 ? (
          <p className="sk-arch__note">{t("unlisted").replace("{n}", String(unlisted))}</p>
        ) : null}
      </div>
    );
  };
}

export function installArchivedSection(ctx) {
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
      createArchivedSection(ctx)
    )
  );
}
