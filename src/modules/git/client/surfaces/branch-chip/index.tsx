/**
 * Composer 里的分支按钮：显示当前分支，点开是可搜索的本地分支列表，底部一条「新建分支」。
 *
 * 为什么挂在 `conversation.input.left`：这是宿主留给插件的、完全空闲的 composer 槽位
 * （`kind:list, scope:session`，内置占用者为空），而且它只在我们这一条输入行里，不会改动
 * 任何宿主节点的位置。弹层必须 portal —— composer 是「贴底」容器，会被它裁切。
 *
 * 数据全部来自本模块自己的三条路由：DSH 宿主没有「切换分支」的实现（`worktrees` 只有
 * create/restore/cleanup），forge 的分支列表只服务 worktree 起点，不能拿来切分支。
 */
import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { findScopedForm } from "../../../../../client/config.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { confirmDialog } from "../../../../../client/ui/components/confirm-dialog/index.jsx";
import { GIT_NS } from "../../locale.js";
import {
  DEFAULT_BRANCH_PREFIX,
  GIT_BRANCHES_PATH,
  GIT_CHECKOUT_PATH,
  GIT_CREATE_BRANCH_PATH,
  MAX_BRANCH_NAME_LENGTH,
  isBranchName,
} from "../../constants.js";
import { EMPTY_VIEW, filterBranches, toBranchView, type BranchView } from "../../model.js";
import panelCss from "./style.css";

export const NAME = "branch-chip";
export const CSS = panelCss;

/** 优先级：排在其它 composer 控件之后，不至于把宿主的左边距挤掉。 */
export const ORDER = 100;

type Busy = "" | "switch" | "create";

interface CreatorState {
  readonly open: boolean;
  readonly draft: string;
  readonly error: string;
}

const CLOSED_CREATOR: CreatorState = { open: false, draft: "", error: "" };

/** 路由的失败载荷 → 给用户看的一行字；缺字段时退回通用文案而不是 `undefined`。 */
function reasonOf(payload: any): string {
  if (payload !== null && typeof payload === "object" && typeof payload.detail === "string" && payload.detail !== "") {
    return payload.detail;
  }
  if (payload !== null && typeof payload === "object" && typeof payload.reason === "string") return payload.reason;
  return "git";
}

export function createBranchChip(ctx: any) {
  const t = ctx.locale.bind(GIT_NS);
  const Menu = primitives.Menu;
  const Input = primitives.Input;
  const MenuItemButton = primitives.MenuItemButton;
  const BranchIcon = primitives.IconBranchOutlineRegular;
  const SearchIcon = primitives.IconSearchOutlineRegular;
  const PlusIcon = primitives.IconPlusOutlineRegular;
  const CheckIcon = primitives.IconCheckOutlineRegular;

  /** 新建分支的预填前缀：设置页写的就是这个字段，读不到就当作空（不加前缀）。 */
  function readPrefix(): string {
    try {
      const { form } = findScopedForm(ctx, "git");
      const snapshot = form?.getSnapshot?.();
      const value = snapshot?.value ?? snapshot;
      const prefix = value?.branchPrefix;
      return typeof prefix === "string" ? prefix : DEFAULT_BRANCH_PREFIX;
    } catch {
      return DEFAULT_BRANCH_PREFIX;
    }
  }

  return function BranchChip(props: any) {
    const { sessionId, useSessions, useProjection } = props;
    // 真正的当前目录：worktree 切换后 workspace 归属目录不变，`workingDirectory` 投影才跟着走。
    const projected = typeof useProjection === "function" ? useProjection("workingDirectory") : undefined;
    const owned = typeof useSessions === "function"
      ? useSessions((snapshot: any) => snapshot?.byId?.[sessionId]?.cwd)
      : undefined;
    const cwd = typeof projected === "string" && projected !== ""
      ? projected
      : (typeof owned === "string" ? owned : "");

    const [view, setView] = React.useState<BranchView>(EMPTY_VIEW);
    const [hidden, setHidden] = React.useState(false);
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [busy, setBusy] = React.useState<Busy>("");
    const [error, setError] = React.useState("");
    const [pending, setPending] = React.useState<{ name: string } | null>(null);
    const [creator, setCreator] = React.useState<CreatorState>(CLOSED_CREATOR);
    // 加载期间不显示「没有分支」：那是读失败与真空仓共用的空态，混在一起会误导。
    const [loading, setLoading] = React.useState(true);

    /** 把一次成功的响应装进视图；失败时只留一行原因，读不到仓库就整块隐藏。 */
    const accept = React.useCallback((payload: any) => {
      setView(toBranchView(payload));
      setHidden(false);
      setError("");
    }, []);

    const load = React.useCallback(async () => {
      if (cwd === "") return;
      setLoading(true);
      try {
        const response = await fetchJson(GIT_BRANCHES_PATH, { json: { cwd } });
        const payload = await response.json().catch(() => null);
        if (response.ok) {
          accept(payload);
        } else if (payload?.reason === "not-a-repository" || payload?.reason === "invalid-cwd") {
          // 不是仓库（或路径失效）时按钮没有意义：直接不渲染，别在输入行里留一个死按钮。
          setHidden(true);
        } else {
          setError(t("branchLoadFailed", { reason: reasonOf(payload) }));
        }
      } catch (cause: any) {
        setError(t("branchLoadFailed", { reason: cause?.message ?? "network" }));
      } finally {
        setLoading(false);
      }
    }, [cwd, t]);

    React.useEffect(() => {
      if (cwd === "") {
        setHidden(true);
        return;
      }
      setHidden(false);
      void load();
    }, [cwd, load]);

    const submit = React.useCallback(async (name: string, create: boolean) => {
      if (cwd === "" || busy !== "") return;
      setBusy(create ? "create" : "switch");
      setError("");
      try {
        const response = await fetchJson(create ? GIT_CREATE_BRANCH_PATH : GIT_CHECKOUT_PATH, { json: { cwd, name } });
        const payload = await response.json().catch(() => null);
        if (response.ok) {
          accept(payload);
          setOpen(false);
          setCreator(CLOSED_CREATOR);
          setPending(null);
        } else {
          const message = t(create ? "branchCreateFailed" : "branchSwitchFailed", { reason: reasonOf(payload) });
          setError(message);
          if (create) setCreator((state) => ({ ...state, error: message }));
        }
      } catch (cause: any) {
        const message = t(create ? "branchCreateFailed" : "branchSwitchFailed", { reason: cause?.message ?? "network" });
        setError(message);
        if (create) setCreator((state) => ({ ...state, error: message }));
      } finally {
        setBusy("");
      }
    }, [accept, busy, cwd, t]);

    /** 切换前：工作区有未提交改动就先确认一次（与 Qoder 的行为一致）。 */
    const pick = React.useCallback((name: string) => {
      if (name === view.branch || busy !== "") return;
      if (view.dirty) {
        setPending({ name });
        return;
      }
      void submit(name, false);
    }, [busy, submit, view.branch, view.dirty]);

    function openCreator() {
      setCreator({ open: true, draft: readPrefix(), error: "" });
    }

    const draft = creator.draft;
    const draftValid = isBranchName(draft);

    if (hidden) return null;

    const label = view.detached || view.branch === "" ? t("branchDetached") : view.branch;
    const trigger = (
      <button
        type="button"
        className="sk-git-branch__trigger"
        aria-haspopup={Menu === undefined ? undefined : "menu"}
        aria-expanded={Menu === undefined ? undefined : open}
        title={t("branchTrigger")}
        onClick={() => {
          if (Menu === undefined) return;
          const next = !open;
          setOpen(next);
          setQuery("");
          if (next) void load();
        }}
      >
        {BranchIcon === undefined ? null : <BranchIcon size={14} />}
        <span className="sk-git-branch__name" data-detached={view.detached || view.branch === "" ? "true" : undefined}>
          {label}
        </span>
      </button>
    );

    const visible = filterBranches(view.branches, query);
    const list = visible.length === 0
      ? (
        <p className="sk-git-branch__empty" role="status">
          {loading ? t("branchLoading") : (view.branches.length === 0 ? t("branchEmpty") : t("branchNoMatch"))}
        </p>
      )
      : visible.map((name) => (
        <MenuItemButton
          key={name}
          icon={BranchIcon === undefined ? undefined : <BranchIcon size={14} />}
          current={name === view.branch}
          disabled={busy !== ""}
          onSelect={() => pick(name)}
        >
          <span className="sk-git-branch__option">
            <span className="sk-git-branch__optionName">{name}</span>
            {name === view.branch && CheckIcon !== undefined ? <CheckIcon size={14} /> : null}
          </span>
        </MenuItemButton>
      ));

    return (
      <>
        {Menu === undefined ? trigger : (
          <Menu
            open={open}
            portal
            dense
            side="top"
            align="start"
            anchor={trigger}
            onClose={() => setOpen(false)}
          >
            <div className="sk-git-branch__menu">
              {Input === undefined ? null : (
                <div className="sk-git-branch__search">
                  <Input
                    autoFocus
                    icon={SearchIcon === undefined ? undefined : <SearchIcon size={14} />}
                    value={query}
                    placeholder={t("branchSearch")}
                    aria-label={t("branchSearch")}
                    onChange={(event: any) => setQuery(event?.target?.value ?? "")}
                  />
                </div>
              )}
              <p className="sk-git-branch__groupLabel">{t("branchMenuTitle")}</p>
              <div className="sk-git-branch__list" role="group" aria-label={t("branchMenuTitle")}>{list}</div>
              <div className="sk-git-branch__footer">
                <MenuItemButton
                  icon={PlusIcon === undefined ? undefined : <PlusIcon size={14} />}
                  disabled={busy !== ""}
                  onSelect={openCreator}
                >
                  {t("branchNew")}
                </MenuItemButton>
              </div>
              {error === "" ? null : <p className="sk-git-branch__error" role="alert">{error}</p>}
            </div>
          </Menu>
        )}
        {pending === null ? null : confirmDialog({
          primitives,
          title: t("branchTrigger"),
          description: t("branchDirty"),
          cancelLabel: t("branchCancel"),
          confirmLabel: t("branchDirtyConfirm"),
          pending: busy !== "",
          pendingLabel: t("branchLoading"),
          onCancel: () => setPending(null),
          onConfirm: () => void submit(pending.name, false),
        })}
        {creator.open ? confirmDialog({
          primitives,
          title: t("branchNewTitle"),
          description: t("branchNewDescription", { branch: view.detached ? "HEAD" : view.branch }),
          children: (
            <div className="sk-git-branch__creator">
              {Input === undefined ? (
                <input
                  className="sk-git-branch__fallbackInput"
                  autoFocus
                  value={draft}
                  maxLength={MAX_BRANCH_NAME_LENGTH}
                  placeholder={t("branchNewPlaceholder")}
                  onChange={(event) => setCreator((state) => ({ ...state, draft: event.target.value }))}
                />
              ) : (
                <Input
                  autoFocus
                  value={draft}
                  maxLength={MAX_BRANCH_NAME_LENGTH}
                  placeholder={t("branchNewPlaceholder")}
                  aria-label={t("branchNewTitle")}
                  onChange={(event: any) => setCreator((state) => ({ ...state, draft: event?.target?.value ?? "" }))}
                  onKeyDown={(event: any) => {
                    if (event?.key === "Enter" && draftValid) {
                      event.preventDefault();
                      void submit(draft, true);
                    }
                  }}
                />
              )}
              <p className="sk-git-branch__hint">
                {t("branchPrefix")}：{readPrefix() === "" ? "—" : readPrefix()}
              </p>
              {creator.error === "" ? null : <p className="sk-git-branch__error" role="alert">{creator.error}</p>}
            </div>
          ),
          cancelLabel: t("branchCancel"),
          confirmLabel: t("branchNewCreate"),
          pending: busy === "create",
          pendingLabel: t("branchNewCreating"),
          onCancel: () => setCreator(CLOSED_CREATOR),
          onConfirm: () => {
            if (!draftValid) {
              setCreator((state) => ({ ...state, error: t("branchNameInvalid") }));
              return;
            }
            void submit(draft, true);
          },
        }) : null}
      </>
    );
  };
}

export function install(ctx: any) {
  // 不传 `inject`：session scope 的槽位本来就会把 `sessionId` / `useProjection` / `useSessions`
  // 作为标准 props 交给组件（宿主 slots 的 standardProps），注入同名字段反而会被判重复。
  return installSlot(ctx, {
    name: "conversation.input.left",
    id: "dsh-toolkit.git.branch",
    order: ORDER,
    locale: GIT_NS,
  }, createBranchChip(ctx));
}
