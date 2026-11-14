/**
 * 面板用的纯投影：把 `/snapshot` 的 JSON 收敛成可直接渲染的结构。
 *
 * 这里不 import 任何 host 文件（`constants.ts` 除外，见 AGENTS §5.4）：host 的
 * `HookView` 之类是进程内类型，客户端拿到的是序列化后的 JSON，形状要单独声明。
 */
import type { HookEventDefinition } from "./constants.js";

export interface HookRow {
  id: string;
  event: string;
  matcher: string;
  command: string;
  timeoutMs: number;
  source: string;
  sourcePath: string;
  supported: boolean;
}

export interface HookFileRow {
  id: string;
  label: string;
  path: string;
  state: string;
  error: string;
}

export interface HookIssueRow {
  id: string;
  severity: string;
  code: string;
  message: string;
  path: string;
  event?: string;
  hookId?: string;
}

export interface HookRunRow {
  id: string;
  at: number;
  event: string;
  command: string;
  source: string;
  decision: string;
  durationMs: number;
  /** 进程起不来时 host 给 null，不能当 0 处理。 */
  code: number | null;
  timedOut: boolean;
  reason: string;
  error: string;
}

export interface HookSnapshotView {
  readAt: number;
  enabled: boolean;
  projectDir: string;
  files: HookFileRow[];
  hooks: HookRow[];
  issues: HookIssueRow[];
  history: HookRunRow[];
}

export interface HookEventGroup {
  event: HookEventDefinition;
  hooks: HookRow[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

/** 容错读取：字段缺失时退化成空值，面板不因为一次坏响应整页白屏。 */
export function readSnapshot(payload: any): HookSnapshotView {
  const body = payload && typeof payload === "object" ? payload : {};
  return {
    readAt: typeof body.readAt === "number" ? body.readAt : 0,
    enabled: body.enabled !== false,
    projectDir: text(body.projectDir),
    files: list(body.files).map((file) => ({
      id: text(file?.id),
      label: text(file?.label),
      path: text(file?.path),
      state: text(file?.state) || "missing",
      error: text(file?.error),
    })),
    hooks: list(body.hooks).map((hook) => ({
      id: text(hook?.id),
      event: text(hook?.event),
      matcher: text(hook?.matcher),
      command: text(hook?.command),
      timeoutMs: typeof hook?.timeoutMs === "number" ? hook.timeoutMs : 60_000,
      source: text(hook?.source) || "user",
      sourcePath: text(hook?.sourcePath),
      supported: hook?.supported !== false,
    })),
    issues: list(body.issues).map((issue) => ({
      id: text(issue?.id),
      severity: text(issue?.severity) || "warning",
      code: text(issue?.code),
      message: text(issue?.message),
      path: text(issue?.path),
      event: text(issue?.event),
      hookId: text(issue?.hookId),
    })),
    history: list(body.history).map((run) => ({
      id: text(run?.id),
      at: typeof run?.at === "number" ? run.at : 0,
      event: text(run?.event),
      command: text(run?.command),
      source: text(run?.source),
      decision: text(run?.decision) || "allow",
      durationMs: typeof run?.durationMs === "number" ? run.durationMs : 0,
      code: typeof run?.code === "number" ? run.code : null,
      timedOut: run?.timedOut === true,
      reason: text(run?.reason),
      error: text(run?.error),
    })),
  };
}

/**
 * 按事件表的分组：顺序跟着 `HOOK_EVENTS` 走，而不是跟着文件里的书写顺序，
 * 这样三个文件合并后同一事件的行仍然挨在一起。
 */
export function groupHooks(snapshot: HookSnapshotView, events: readonly HookEventDefinition[]): HookEventGroup[] {
  const groups: HookEventGroup[] = [];
  for (const definition of events) {
    const rows = snapshot.hooks.filter((hook) => hook.event === definition.id);
    if (rows.length > 0) groups.push({ event: definition, hooks: rows });
  }
  // 事件表里没有的名字（比如用户拼错的）也要能看见，否则页面上「总数」对不上。
  const known = new Set(events.map((definition) => definition.id));
  for (const hook of snapshot.hooks) {
    if (known.has(hook.event)) continue;
    known.add(hook.event);
    groups.push({
      event: { id: hook.event, label: hook.event, hint: "", matcher: "none", supported: false },
      hooks: snapshot.hooks.filter((row) => row.event === hook.event),
    });
  }
  return groups;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** matcher 的展示文案：空串与 `*` 都是「全部」。 */
export function matcherLabel(matcher: string, allLabel: string): string {
  const trimmed = matcher.trim();
  return trimmed === "" || trimmed === "*" ? allLabel : trimmed;
}

export interface RunProblemLabels {
  timedOut: string;
  exit: (code: number) => string;
}

export interface RunProblem {
  text: string;
  tone: "error" | "reason" | "none";
}

/**
 * 「最近执行」右侧那行补充说明。
 *
 * 一条记录里可能同时有 退出码 / 超时 / error / reason，但一行只放得下一句：
 * 失败优先（起不来 > 超时 > 非零退出码），其次是 hook 自己给的理由（deny 时的 stderr）。
 * `code` 为 null 表示进程根本没起来，这时必须显示 error，不能显示「退出码 null」。
 */
export function runProblem(run: HookRunRow, labels: RunProblemLabels): RunProblem {
  const error = run.error.trim();
  if (error !== "") return { text: error, tone: "error" };
  if (run.timedOut) return { text: labels.timedOut, tone: "error" };
  if (typeof run.code === "number" && run.code !== 0) {
    return { text: labels.exit(run.code), tone: "error" };
  }
  const reason = run.reason.trim();
  if (reason !== "") return { text: reason, tone: "reason" };
  return { text: "", tone: "none" };
}
