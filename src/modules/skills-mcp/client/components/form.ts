/**
 * Form definitions for servers and skills: labels, hint texts and validation.
 *
 * The hint texts are part of the product copy (they explain the accepted shape
 * of each field), so they live here with tests pinning them.
 */

/** Hint texts, kept in one place because they are user-facing copy. */
export const HINTS = {
  serverName: '例如 context7，最多 32 字符',
  command: 'npx',
  args: '-y @scope/pkg@latest',
  env: 'TEST_TOKEN=sk-xxxxxxx\n多个变量一行一个，例如：\nAPI_KEY=sk-abc\nREGION=cn',
  url: 'https://…/mcp',
  headers: 'Authorization=Bearer sk-xxxxxxx\n多个请求头一行一个，用等号连接（与 Host 的解析一致）',
  project: '请选择项目',
}

/** Fields of the server form, in render order. */
export function serverFieldDefs() {
  return [
    { key: 'serverName', label: '名称（serverName）', hint: HINTS.serverName },
    { key: 'transport', label: '传输', kind: 'select' },
    { key: 'url', label: 'URL', hint: HINTS.url, when: 'http' },
    { key: 'headers', label: '请求头（KEY=VALUE，每行一个）', hint: HINTS.headers, kind: 'textarea', when: 'http' },
    { key: 'command', label: '命令', hint: HINTS.command, when: 'stdio' },
    { key: 'args', label: '参数（空格分隔）', hint: HINTS.args, when: 'stdio' },
    { key: 'env', label: '环境变量（KEY=VALUE，每行一个）', hint: HINTS.env, kind: 'textarea', when: 'stdio' },
  ]
}

/** Fields of a skill form. */
export function skillFieldDefs() {
  return [
    { key: 'name', label: '技能名', hint: '例如 code-review，最多 64 字符' },
    { key: 'description', label: '描述', hint: '一句话说明这个技能做什么' },
    { key: 'body', label: '正文（SKILL.md）', kind: 'textarea' },
  ]
}

/** Names accepted for both servers and skills (the Host validates the same shape). */
export function isValidName(name, max = 32) {
  return new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test((name ?? '').trim())
}

/** The server fields these validators read; callers pass a draft, a row or `{}`. */
export interface ServerDraftShape {
  serverName?: string
  transport?: string
  command?: string
  url?: string
}

/** The skill fields these validators read. */
export interface SkillDraftShape {
  name?: string
  body?: string
}

/**
 * One field-level problem, keyed by the draft field it belongs to.
 *
 * The whole-draft validators below answer "may this be saved?"; a form that only
 * shows that answer has nowhere to put it. Issues add the one thing the views need
 * to place the message under the offending control.
 */
export interface FieldIssue {
  key: string
  message: string
}

/** Id of the error slot a field renders (empty and `hidden` until an issue is shown). */
export function fieldErrorId(prefix: string, key: string): string {
  return `${prefix}-${key}-error`
}

/** Id of the control itself, so a submit failure can move focus to it. */
export function fieldControlId(prefix: string, key: string): string {
  return `${prefix}-${key}`
}

/** Field-level issues of a skill draft, in form order. */
export function skillDraftIssues(draft: SkillDraftShape = {}): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (!isValidName(draft.name, 64)) {
    issues.push({ key: 'name', message: '名称只能用字母、数字、- 和 _，且不超过 64 个字符' })
  }
  if ((draft.body ?? '').trim() === '') issues.push({ key: 'body', message: '请填写技能正文' })
  return issues
}

/** Field-level issues of a server draft, in form order. */
export function serverDraftIssues(draft: ServerDraftShape = {}): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (!isValidName(draft.serverName, 32)) {
    issues.push({ key: 'serverName', message: '名称只能用字母、数字、- 和 _，且不超过 32 个字符' })
  }
  const transport = draft.transport ?? 'streamable-http'
  if (transport === 'stdio') {
    if ((draft.command ?? '').trim() === '') issues.push({ key: 'command', message: 'stdio 传输需要填写命令' })
    return issues
  }
  if ((draft.url ?? '').trim() === '') issues.push({ key: 'url', message: 'http 传输需要填写 URL' })
  return issues
}

/** Validate a server draft; returns a message or null when it may be saved. */
export function validateServerDraft(draft: ServerDraftShape = {}) {
  return serverDraftIssues(draft)[0]?.message ?? null
}

/** Validate a skill draft; returns a message or null. */
export function validateSkillDraft(draft: SkillDraftShape = {}) {
  return skillDraftIssues(draft)[0]?.message ?? null
}

/** `document` only exists in the browser; the pure validators above are also unit-tested in node. */
function formDocument(): Document | null {
  return typeof document === 'undefined' ? null : document
}

function byId(doc: Document | null, id: string): HTMLElement | null {
  // 测试/只读渲染会把一个只有 querySelector 的假 document 传进来，缺少 getElementById。
  if (doc === null || typeof doc.getElementById !== 'function') return null
  return (doc.getElementById(id) as HTMLElement | null) ?? null
}

/**
 * Block a submit: put each message in the slot its field already renders, mark the
 * control `aria-invalid`, and move focus to the first offending field.
 *
 * Why plain DOM: the two views are pure render functions called from the panel's own
 * render body (no state of their own, and `panel.tsx` is out of scope here). The
 * attributes they write are therefore written **once** as React props — no prop ever
 * changes, so a later re-render cannot undo this. Editing a field clears its own slot.
 */
export function showFieldIssues(prefix: string, issues: FieldIssue[], doc: Document | null = formDocument()): void {
  for (const issue of issues) {
    const error = byId(doc, fieldErrorId(prefix, issue.key))
    if (error !== null) {
      error.textContent = issue.message
      error.hidden = false
    }
    byId(doc, fieldControlId(prefix, issue.key))?.setAttribute('aria-invalid', 'true')
  }
  const first = issues[0]
  if (first !== undefined) byId(doc, fieldControlId(prefix, first.key))?.focus()
}

/** Clear one field's message (called from its `onChange`, i.e. as soon as the user reacts). */
export function clearFieldIssue(prefix: string, key: string, doc: Document | null = formDocument()): void {
  const error = byId(doc, fieldErrorId(prefix, key))
  if (error !== null) {
    error.textContent = ''
    error.hidden = true
  }
  byId(doc, fieldControlId(prefix, key))?.setAttribute('aria-invalid', 'false')
}

/**
 * Keep `aria-invalid` in step with the browser's own validity (`:user-invalid`).
 *
 * `required` / `pattern` give the user the native "this is wrong" affordance; the
 * attribute is what assistive tech reads, and the two must not disagree.
 */
export function syncAriaInvalid(control: any): void {
  if (control === null || control === undefined) return
  const valid = control.validity === undefined || control.validity.valid !== false
  control.setAttribute('aria-invalid', valid ? 'false' : 'true')
}

/**
 * One edit of a field: drop the submit-time message, then let the browser's own validity
 * decide `aria-invalid` — so the attribute never disagrees with `:user-invalid`, which the
 * stylesheet also keys off. Called from every `onChange` in both forms.
 */
export function fieldEdited(prefix: string, key: string, control: any, doc: Document | null = formDocument()): void {
  clearFieldIssue(prefix, key, doc)
  syncAriaInvalid(control)
}

/** Whether a field applies to the draft's transport. */
export function fieldApplies(field, draft: ServerDraftShape = {}) {
  if (field.when === undefined) return true
  const stdio = (draft.transport ?? 'streamable-http') === 'stdio'
  return field.when === 'stdio' ? stdio : !stdio
}
