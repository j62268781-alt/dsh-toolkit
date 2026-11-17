/**
 * 分支按钮的纯投影：把 HTTP 载荷收拾成界面能直接用的形状，以及弹层里的搜索过滤。
 *
 * 不 import React、不碰 DOM —— 这两件事都能脱离组件单测（`tests/git/branch-model.test.mjs`）。
 */

/** 与 host 侧 `BranchSnapshot` 对齐的界面视图。 */
export interface BranchView {
  readonly root: string;
  readonly branch: string;
  readonly detached: boolean;
  readonly dirty: boolean;
  readonly branches: readonly string[];
}

export const EMPTY_VIEW: BranchView = { root: "", branch: "", detached: false, dirty: false, branches: [] };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * HTTP 载荷 → 视图。宿主版本落后时字段可能缺，任何缺失都退回安全默认值而不是抛错：
 * 一个读不懂的响应不该让 composer 里的按钮变成一片红色报错。
 */
export function toBranchView(payload: any): BranchView {
  return {
    root: typeof payload?.root === "string" ? payload.root : "",
    branch: typeof payload?.branch === "string" ? payload.branch : "",
    detached: payload?.detached === true,
    dirty: payload?.dirty === true,
    branches: strings(payload?.branches),
  };
}

/**
 * 弹层里的本地过滤。
 *
 * 与 Qoder 一致：按空白分词、每个词都要命中（`feat/re` 能命中 `feat/review-panel`）。
 * 首尾空白不算一个词——否则输入框里刚敲下的空格就会把列表清空。
 */
export function filterBranches(branches: readonly string[], query: string): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return [...branches];
  return branches.filter((branch) => {
    const haystack = branch.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/** 新建分支输入框的预填值：前缀 + 用户已经打的字（前缀为空时原样返回）。 */
export function prefilledBranchName(prefix: string, typed: string): string {
  return `${prefix}${typed}`;
}

/**
 * 同一个分支按钮挂在两个位置（新会话顶栏 / 已开始会话的 composer），只能显示一个：
 * 新会话页顶栏已经有宿主的 worktree 控件，再露出底栏按钮就是用户说的「2 个 git」。
 * `blank` 取宿主自己的口径（session 快照的 `blank`，见会话行的 hero 判定）。
 */
export function showsAt(placement: "hero" | "composer", blank: boolean): boolean {
  return placement === "hero" ? blank : !blank;
}
