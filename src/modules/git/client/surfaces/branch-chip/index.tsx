/**
 * 分支按钮：显示当前分支，点开是可搜索的本地分支列表，底部一条「新建分支」。
 *
 * 同一个组件挂两处，按会话状态互斥：
 * - `conversation.input.left`：已经开始对话的会话，就在我们那条输入行的左侧；
 * - `conversation.hero.options`：新会话页的顶栏（`[项目] [标准模式] … [基于 main] [新建工作树]`）。
 *   宿主把这一行做成了右对齐的 list 槽，是那排控件旁边唯一能增量挂载的位置 ——
 *   `hero.workspace` / `hero.agentPreset` 都是 single，占位就等于替换宿主的控件。
 *   那颗 toggle 在没勾选「新建工作树」时显示的是**只读**的当前分支标签（`<Tooltip openOnClick>`，
 *   没有 onClick），所以在顶栏里我们不另起一颗按钮：order 取 -1 排到它前面，同位置接管
 *   那颗标签（CSS 里把宿主的藏起来，见 style.css 的 hero 段），点它就是开分支菜单。
 *   勾上「新建工作树」后宿主换成「基于 X ⌄」的基线选择器，那时按宿主默认走，我们让位。
 *
 * 两处不能同时显示：新会话时顶栏那行本来就有 git 信息，再来一个底栏按钮就是「2 个 git」。
 * 互斥判据用宿主自己的口径 —— session 快照的 `blank`（`summaryBlank`）。
 *
 * 弹层必须 portal —— composer 是「贴底」容器，会被它裁切。
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
import { EMPTY_VIEW, filterBranches, showsAt, toBranchView, type BranchView } from "../../model.js";
import panelCss from "./style.css";

export const NAME = "branch-chip";
export const CSS = panelCss;

/** 优先级：排在其它 composer 控件之后，不至于把宿主的左边距挤掉。 */
export const ORDER = 100;

/** 新会话顶栏：宿主 worktree toggle 的 order 缺省是 0，我们要占住它那颗只读分支标签的位置，所以排到它前面。 */
export const HERO_ORDER = -1;

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
  const ChevronIcon = primitives.IconChevronDownOutlineRegular;
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
    const hero = props.placement === "hero";
    // 宿主的 hero 行只在 `summaryBlank` 时渲染；底栏反过来只在非 blank 时显示，
    // 否则新会话页会同时出现顶栏 git 与底栏分支按钮。
    const blank = typeof useSessions === "function"
      ? useSessions((snapshot: any) => snapshot?.byId?.[sessionId]?.blank === true)
      : false;
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
    // 脏工作区确认框自己留一条失败原因：此时分支菜单已经收起，菜单里的 error 用户看不到。
    const [switchError, setSwitchError] = React.useState("");
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
      setSwitchError("");
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
          else setSwitchError(message);
        }
      } catch (cause: any) {
        const message = t(create ? "branchCreateFailed" : "branchSwitchFailed", { reason: cause?.message ?? "network" });
        setError(message);
        if (create) setCreator((state) => ({ ...state, error: message }));
        else setSwitchError(message);
      } finally {
        setBusy("");
      }
    }, [accept, busy, cwd, t]);

    /** 切换前：工作区有未提交改动就先确认一次（与 Qoder 的行为一致）。 */
    const pick = React.useCallback((name: string) => {
      if (busy !== "") return;
      if (name === view.branch) {
        // 点当前分支不是错误，只是没事可做：收菜单位置留给「已经在这个分支上」这个反馈。
        setOpen(false);
        return;
      }
      if (view.dirty) {
        setSwitchError("");
        setPending({ name });
        return;
      }
      void submit(name, false);
    }, [busy, submit, view.branch, view.dirty]);

    function openCreator() {
      // 新建分支是独立的确认弹窗，弹层留着会跟它叠在一起、还会盖住遮罩上的点击区域。
      setOpen(false);
      setQuery("");
      setCreator({ open: true, draft: readPrefix(), error: "" });
    }

    const draft = creator.draft;
    const draftValid = isBranchName(draft);

    if (!showsAt(hero ? "hero" : "composer", blank)) return null;
    if (hidden) return null;

    const label = view.detached || view.branch === "" ? t("branchDetached") : view.branch;
    const trigger = (
      <button
        type="button"
        className={hero ? "sk-git-branch__trigger sk-git-branch__trigger--hero" : "sk-git-branch__trigger"}
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
        {/* 图标必须包一层 flex:none：标签被 max-width 夹住时，裸 <svg> 会被压扁成 5×14。 */}
        {BranchIcon === undefined ? null : (
          <span className="sk-git-branch__icon" aria-hidden={true}>
            <BranchIcon size={hero ? 16 : 14} />
          </span>
        )}
        <span className="sk-git-branch__name" data-detached={view.detached || view.branch === "" ? "true" : undefined}>
          {label}
        </span>
        {/* 箭头：宿主那颗只读标签没有，用户看不出能点；输入行里则对齐权限按钮的 14px 箭头。 */}
        {ChevronIcon === undefined ? null : (
          <span
            className={open ? "sk-git-branch__chevron sk-git-branch__chevron--open" : "sk-git-branch__chevron"}
            aria-hidden={true}
          >
            <ChevronIcon size={hero ? 12 : 14} />
          </span>
        )}
      </button>
    );

    const visible = filterBranches(view.branches, query);
    const visibleRemotes = filterBranches(view.remotes, query);
    const branchItem = (name: string, current: boolean) => (
      <MenuItemButton
        key={current ? `local:${name}` : `remote:${name}`}
        icon={BranchIcon === undefined ? undefined : <BranchIcon size={14} />}
        current={current}
        disabled={busy !== ""}
        onSelect={() => pick(name)}
      >
        <span className="sk-git-branch__option">
          <span className="sk-git-branch__optionName">{name}</span>
          {current && CheckIcon !== undefined ? <CheckIcon size={14} /> : null}
        </span>
      </MenuItemButton>
    );
    const list = visible.length === 0 && visibleRemotes.length === 0
      ? (
        <p className="sk-git-branch__empty" role="status">
          {loading
            ? t("branchLoading")
            : (view.branches.length === 0 && view.remotes.length === 0 ? t("branchEmpty") : t("branchNoMatch"))}
        </p>
      )
      : (
        <>
          {visible.map((name) => branchItem(name, name === view.branch))}
          {visibleRemotes.length === 0 ? null : (
            <p className="sk-git-branch__groupLabel sk-git-branch__groupLabel--nested">
              {t("branchRemotes")}
              <span className="sk-git-branch__groupHint">{t("branchTrackHint")}</span>
            </p>
          )}
          {visibleRemotes.map((name) => branchItem(name, false))}
        </>
      );

    return (
      <>
        {Menu === undefined ? trigger : (
          <Menu
            open={open}
            portal
            dense
            side={hero ? "bottom" : "top"}
            align={hero ? "end" : "start"}
            anchor={trigger}
            onClose={() => setOpen(false)}
          >
            <div className="sk-git-branch__menu">
              {Input === undefined ? null : (
                <div className="sk-git-branch__search">
                  <Input
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
          children: switchError === "" ? null : <p className="sk-git-branch__error" role="alert">{switchError}</p>,
          cancelLabel: t("branchCancel"),
          confirmLabel: t("branchDirtyConfirm"),
          pending: busy !== "",
          pendingLabel: t("branchLoading"),
          onCancel: () => {
            setPending(null);
            setSwitchError("");
          },
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

export function installHero(ctx: any) {
  return installSlot(ctx, {
    name: "conversation.hero.options",
    id: "dsh-toolkit.git.branch",
    order: HERO_ORDER,
    locale: GIT_NS,
    inject: () => ({ placement: "hero" }),
  }, createBranchChip(ctx));
}
