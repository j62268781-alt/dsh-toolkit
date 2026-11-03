# DSH 0.2.1-rc.5 — client plugin runtime notes (session observation / settings section / notification click)

Everything below was read out of the **unminified runtime bundles already cached in `.cache/bundles/`** plus the
**installed app.asar** (`D:\软件\deepseek\resources\app.asar`, extracted read-only through an inline Node asar reader).
Line numbers refer to those exact files.

- Cache bundles: `.cache/bundles/<pkg>.js` (76 files, rev from `.cache/boot.json` = `809e33d72d26`).
- The boot manifest is `.cache/boot.json`; it is the authoritative list of “packages that are in the client graph”.
- `app.asar` holds `dsh/node_modules/@deepseek-ai/<pkg>/{lib/*.js,README.md,package.json}` (no `.d.ts` anywhere;
  types live as JSDoc in `lib/types/**/*.js` and as a generated declaration manifest inside
  `@deepseek-ai/dsh-cordis-client-runner`).
- Web shell seed table + `staticModules`: `.cache/bundle-1.js` `function OZ(){…}` (char ~919724).

---

## A. SESSION OBSERVATION

### A1. `ctx.sessions` — provided by `@deepseek-ai/dsh-api-session-controller`

**Service name / registration.** The service is *reflected*, not a `Service` subclass:

```js
// dsh-api-session-controller.js:3840
rootCtx.reflect.provide("sessions", this, undefined);
```

So a Cordis plugin asks for `sessions`:

```js
export const inject = ['sessions']              // ctx.sessions
```

The package's own service inject list (what must be up before *it* can run) is
`["connection","fileUpload","typert","remote","remote.commands","remote.session","remote.subagents"]`
(`dsh-api-session-controller.js:4249-4257`) — irrelevant to consumers.

**List snapshot.** `createSnapshotStore({ ids: [], byId: {}, phase: "pending", projectionsBySession: {} })`
(`:3814-3819`). Declared type (`dsh-cordis-client-runner.js:2165-2167`):

```ts
export interface SessionListState {
    ids: SessionId[];
    byId: Record<SessionId, SessionSummary>;
    phase: SessionListPhase;                 // 'pending' | 'ready'
    projectionsBySession: Readonly<Record<SessionId, SessionProjectionSnapshot>>;
}
```

Row shape actually published by `projectList()` (`dsh-api-session-controller.js:4146-4227`):

```js
byId[entry.sessionId] = {
  id: entry.sessionId,
  displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId), // title → workspace basename → id
  running: entry.running,          // boolean, host list baseline / api-session/status
  retainedBy: this.retentionSnapshot(entry.sessionId).retainedBy,  // { mainView?: n, gateway?: n, ... }
  blank: entry.blank,
  updatedAt: entry.updatedAt,      // ms epoch, durable activity
  formatStatus: entry.formatStatus,
  ...projectionValues === undefined ? {} : { projectionValues },  // e.g. { agentPreset, title }
  ...entry.title    !== undefined ? { title }    : {},
  ...entry.cwd      !== undefined ? { cwd }      : {},
  ...entry.parentSessionId !== undefined ? { parentId } : {},
  ...entry.origin   !== undefined ? { origin }   : {},            // subagent rows: origin: "subagent"
};
```

Subagent catalog rows injected at `:4168-4193` and retained-scope fallbacks at `:4194-4220` add
`parentId` + `origin: "subagent"`, `running` from the live scope snapshot, `updatedAt: 0` when unknown.
`displayTitleOf` is `:3700-3707`. Note `projectionValues` is **only a cached hint** — api/session-controller
refreshes it explicitly (`refreshProjections`, `:3899-3901`).

**Subscriptions.** Plain observable-store API:

```js
ctx.sessions.list.getSnapshot()          // SessionListState
const off = ctx.sessions.list.subscribe(() => { /* any list/retention/status mutation */ })
ctx.sessions.retainInfo(id).getSnapshot() // { referenceCount, retainedBy: { [source]: count } }
ctx.sessions.retainInfo(id).subscribe(fn)
```

`retainInfo(id)` is stable per id and never throws (unknown id → frozen `EMPTY_RETAIN_INFO`)
(`dsh-api-session-controller.js:3865-3885`, `:3726-3729`).

**`binding(id)`** — borrow, does **not** retain (`:4056-4058`):

```js
binding(id) { return this.scopes.get(id)?.binding; }   // undefined when no retained generation
```

`SessionBinding` = `{ sessionId, session: SessionFace, eventSource: SessionEventSource, ctx: AgentContext }`
(`dsh-cordis-client-runner.js:2133-2135`). `SessionFace` = `ISession & ObservableSnapshot<SessionSnapshot>`
(`:2153-2155`), `SessionSnapshot` = `{ sessionId, pendingSubmissions, running, subagent, removed, openState,
openError, hasMore, loadingOlder, promptError, blank, lastAgentError, promptAttempted, awaitingFirstTurn }`
(`:2209-2211`). `eventSource` / `session.eventSource` is `ObservableSnapshot<SessionEventWindow>` where
`SessionEventWindow = { entries, hasMore, revision, change }` and `entries` are
`{ type:'event', event } | { type:'transient', event }` (`:2144-2150`).

**`using(target, options, fn)`** — retain → await ready → run → always release (`:3856-3864`):

```js
async using(target, options, operation) {
  const reference = this.retain(target, options);
  try { await reference.ready; return await operation(reference); }
  finally { reference.release(); }
}
```

`retain(target, { source, signal })` → `SessionReference { sessionId, binding, ready, release(), [Symbol.dispose]() }`
(`:3745-3787`, `:3842-3855`). `SessionTarget = SessionId | SubagentAddress` (`dsh-cordis-client-runner.js:2216-2218`)
— i.e. a **branded string**, never an object. `await reference.ready` means “the binding exists”, **not** “history
loaded” (history arrives through `eventSource`; check `openState`/`hasMore`).

**`SessionReferenceSourceMap` — how to get a legal `source`.** The declared map in rc.5
(`dsh-cordis-client-runner.js:2188-2191`) is:

```ts
export interface SessionReferenceSourceMap { controllerOperation: unknown; gateway: unknown; }
export type SessionReferenceSource = Extract<keyof SessionReferenceSourceMap, string>;
export interface SessionRetainOptions { readonly source: SessionReferenceSource; readonly signal?: AbortSignal }
```

Two facts matter:

1. **There is no runtime validation.** `retainScope` just does
   `{ ...previous.retainedBy, [source]: (previous.retainedBy[source] ?? 0) + 1 }`
   (`dsh-api-session-controller.js:4059-4087`) — any string is accepted and counted.
2. **`mainView` is reserved** and is *not* in that map text, yet the workspace uses it
   (`dsh-client-ui-workspace.js:1654`). `mainView` is what `uiSession.isMain()` tests
   (`dsh-client-ui-session.js:973-975`), so a plugin must **never** spend or emit `mainView`.

Legal, side-effect-free choices for a plugin:

```js
// (a) declared, safe: 'gateway' — the source the controller itself uses for ad-hoc scope retention
const ref = ctx.sessions.retainAgentScope(id);          // :4021-4024, source: "gateway" hard-coded
ref.release();

// (b) declared, safe: 'controllerOperation'
const ref2 = ctx.sessions.retain(id, { source: 'controllerOperation' });

// (c) preferred: using() with the same source, released for you
await ctx.sessions.using(id, { source: 'controllerOperation' }, async (reference) => { /* ... */ });
```

> If a module wants its own bucket in `retainedBy` it must *also* module-augment
> `SessionReferenceSourceMap` in its `.d.ts`; at runtime any key works, but a private key (e.g.
> `"dsh-notification"`) is the honest choice and cannot collide with `mainView`. Do not use `mainView`.

Other useful members: `scope(id)`, `scopeOf(ctx)`, `sessionOf(ctx)`, `subagentAddress(id)` (`:3886-3894`),
`refresh()` (`:3906-3908`), `refreshProjections(id)`, `search(query, signal)`, `create(opts)`, `fork(opts)`,
`archive`-adjacent work belongs to `ctx.workspaces`.

### A2. `ctx.uiSession` — `@deepseek-ai/dsh-client-ui-session`

`class UiSession extends Service { … super(ctx, "uiSession") }` (`dsh-client-ui-session.js:766`, `:798`).
Inject: `["sessions","slots","remote","remoteAccess"]` (`:1092-1097`). Consumer: `inject = ['uiSession']`.

**`sessionStatus`** is a plain `{ getSnapshot, subscribe }` source over a `Map` (`:782-790`):

```js
sessionStatus = {
  getSnapshot: () => this.statusSnapshot,          // Map<SessionId, SessionStatusSnapshot>
  subscribe: (listener) => { /* … */ },
}
```

`SessionStatusSnapshot` (`:976-992`):

```js
{ running: boolean | undefined,           // undefined until the first baseline/status event
  pendingInteraction: object | undefined, // see below
  completionUnread: boolean }
```

**Coverage: every catalogued session, not only opened ones.** `publishStatus()` builds the id set from
`Object.keys(sessions.list.getSnapshot().byId) ∪ running.keys() ∪ pendingSnapshot.keys() ∪ completionUnread`
(`:977-982`), so `byId` membership alone guarantees an entry (`running` may still be `undefined`).

**`completionUnread` semantics** (`:948-955`): set when a session goes `running true → false` **and** it is not
the main view; cleared when it starts running again or when it becomes the main view (`:965`, `:973-975`).
This is the *only* built-in “finished edge” flag. For a raw edge (running → not running) poll
`sessionStatus` or the sessions list; both are driven by:
- `ctx.remote.$on("api-session/status", (sessionId, running) => …)` (`:814-816`),
- list reconciliations (`:956-972`).

**`pendingInteraction`** is whatever the owning domain published through
`ctx.uiSession.registerPendingInteraction(precedence)` (`:876-893`). Two shipped shapes:

```js
// approval (dsh-client-ui-approval.js:178-202)
{ sessionId, kind: "approval", key: `approval:${n}`, toolName, callId?, reason?, displayReason? }

// user question (dsh-client-ui-user-questions.js:135-193, kind chosen at :185)
{ sessionId, kind: "question" | "plan-review", key: `question:${sessionId}:${callId}`,
  questions: [...], callId?, review?, dismissal: "hide" | "cancel" }
```

So `pendingInteraction.kind ∈ {"approval","question","plan-review"}` (plus whatever other plugins publish).
Treat it as opaque: read `.kind`, `.sessionId`, and for questions `.questions.length`.

Also published to the slot root so React components get `useSessionStatus` / `useSessions` standard props
(`dsh-client-ui-session.js:1104-1113`):

```js
ctx.slots.provideRoot({
  hooks: { sessions: ctx.sessions.list, sessionStatus: service.sessionStatus },
  keyedHooks: { sessionRetainInfo: (key) => ctx.sessions.retainInfo(key),
                sessionAccess: (sessionId, action) => … },
});
```

### A3. Chat nodes from a plugin — `ctx.uiConversation` + `.target('chat')`

Service `uiConversation` (`dsh-client-ui-conversation.js:4040-4041`), inject list is `sessions` + `remote` etc.
Public read path:

```js
// dsh-client-ui-conversation.js:4078-4099
binding(source)            // source = SessionId | SessionBinding  → BoundConversation
                           // throws `uiConversation.binding: unknown session` / `inactive session`
// :3921-3954 (BoundConversation)
binding.activate('chat')   // materialize the target
binding.target('chat')     // → { getSnapshot, subscribe }; subscribing ALSO activates (:3943)
binding.getSnapshot()      // whole published snapshot (:4016)
```

`views.get(target)?.snapshot` is the storage (`:2736-2759`): `activateTarget(target)` creates/materializes the
view, `snapshot(target)` returns `undefined` **before registration or activation** — so call `activate('chat')`
before reading, or use `target('chat').subscribe(...)` and read from the callback.

**Chat snapshot shape** (`dsh-client-ui-chat.js:9441-9450`, registered as target `"chat"` at `:9466-9470`):

```js
{ order: string[],      // ordered node keys
  nodes,                // ChatNodeStore: nodes.get(key) / nodes.values() / nodes.size
  locations, navigation, timeline, legacy }
```

Node objects are `{ kind, key, anchorSeq, visibility: 'visible'|'hidden', location, groupTree?, data }`.
`ChatNodeKind` (fixed key table, `dsh-cordis-client-runner.js:2701`):

```
assistant-step, command, command-input, compaction, context, manual-compaction, model-retry,
question-reply, steering, system-prompt, tool-call, turn-error, turn-max-tokens, turn-process,
turn-tail, turn-trigger, unknown, user, workflow-run
```

Data shapes we need (all from `dsh-client-ui-chat.js`):

```js
// user / steering  (:9900-9914)
{ kind: 'user' | 'steering', seq, time, content, source }
//   content blocks are { type: 'text', text }  ← note: `type`, not `kind`  (:8348-8351)
//   source.kind === 'user' for a human message  (:9890)

// assistant-step  (:8126-8190; block accumulation :7968-8007)
{ kind: 'assistant-step', turn, step, blocks: [
    { kind: 'text', text } | { kind: 'reasoning', text } | { kind: 'tool-call', callId, name, argsRaw } ],
  status, finalNode? }

// turn-error  (:10498-10589)
{ kind: 'turn-error', seq, time, turn, step, message, code? }
```

The official text-extraction idiom is exactly (`:8348-8355`):

```js
function promptText(node)   { return node.kind !== 'user' ? '' : node.data.content.flatMap(b => b.type === 'text' ? [b.text] : []).join(' ') }
function responseText(node) { return node.kind !== 'assistant-step' ? '' : node.data.blocks.flatMap(b => b.kind === 'text' ? [b.text] : []).join(' ') }
```

**Copy-paste extraction (with correct lifetime):**

```js
// cordis inject: ['sessions', 'uiConversation']
function readChatDigest(ctx, sessionId) {
  const out = { running: false, title: '', user: '', assistant: '', error: null, kinds: [] }
  const row = ctx.sessions.list.getSnapshot().byId[sessionId]
  out.running = row?.running === true
  out.title = row?.displayTitle ?? ''

  // uiConversation.binding() requires a live session scope (sessions.binding(id) !== undefined)
  const reference = ctx.sessions.retain(sessionId, { source: 'controllerOperation' })
  try {
    const conversation = ctx.uiConversation.binding(sessionId)
    conversation.activate('chat')
    const snapshot = conversation.target('chat').getSnapshot()
    if (snapshot === undefined || snapshot.nodes === undefined) return out
    const nodes = snapshot.order.map((key) => snapshot.nodes.get(key)).filter(Boolean)
    out.kinds = nodes.map((node) => node.kind)
    const lastUser = nodes.findLast((n) => n.kind === 'user')
    const lastAssistant = nodes.findLast((n) => n.kind === 'assistant-step')
    const lastError = nodes.findLast((n) => n.kind === 'turn-error')
    out.user = lastUser === undefined ? '' :
      lastUser.data.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ').trim()
    out.assistant = lastAssistant === undefined ? '' :
      lastAssistant.data.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : [])).join(' ').trim()
    out.error = lastError === undefined ? null : { message: lastError.data.message, seq: lastError.data.seq }
  } finally {
    reference.release()
  }
  return out
}
```

Caveats (important, verified):
- `binding()` throws for an unknown/inactive session (`:4081-4082`); always retain first and keep the
  reference alive across the read.
- The snapshot is built from the **loaded event window** of that session. A just-retained session can be
  `openState: 'loading'` with `nodes` empty. For notification *text*, prefer `displayTitle` +
  `pendingInteraction.kind` and treat chat text as best-effort.
- `activate('chat')`/`subscribe` permanently marks the target active in the shared assembler
  (`:2736-2745`) — avoid doing it for every session on every tick.
- Cheaper alternative that needs no target activation: read raw events off
  `reference.binding.eventSource.getSnapshot()` (`{ entries, hasMore, revision, change }`) — same shapes the
  definitions consume (`turn/start`, `user/message`, `assistant/message`, `turn/end`).
- Chat nodes **are not** exposed as slots service data; there is no `ctx.uiChat` service. `ui-chat` only
  contributes slot occupants + the `views`/`events`/`groups` definitions.

### A4. How the toolkit itself touches these (version-guard patterns to copy)

`src/modules/archived/client/model.js:20-25` — snapshot read with full optional chaining:

```js
export function readArchived(ctx) {
  const sessions = ctx.sessions?.list?.getSnapshot?.() ?? {};
  const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? {};
  const byId = sessions.byId ?? {};
  const items = Array.isArray(workspaces.items) ? workspaces.items : [];
  const archived = [...new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : [])];
```

`src/modules/archived/client/section.jsx:64-80` — `subscribe` in a `try/catch` per source:

```jsx
React.useEffect(() => {
  const rerender = () => bump((n) => n + 1);
  const offs = [];
  try { offs.push(ctx.sessions.list.subscribe(rerender)); } catch {}
  try { offs.push(ctx.workspaces.list.subscribe(rerender)); } catch {}
  return () => { for (const off of offs) { try { off(); } catch {} } };
}, []);
```

Other guards in the same module: `ctx.sessions.refresh?.()` (`removal.jsx:69`), `ctx.sessions?.list?.getSnapshot?.()?.byId?.[id]`
(`archive-confirm.jsx:96`). Declared inject (`archived/client/index.js:9`):

```js
export const inject = ["slots", "locale", "sessions", "workspaces"];
```

There is **no** version-number check anywhere in the toolkit — only `?.` + `try/catch` feature detection.
That is the right pattern for us too, because `settings.section`/`uiSession` may be absent in a stripped composition.

---

## B. NAVIGATION / NOTIFICATION CLICK

### B5. `ctx.uiWorkspace.openSession(target)`

Service `uiWorkspace` (`dsh-client-ui-workspace.js:1380`), inject list
`["slots","sessions","workspaces","locale","remote","remote.directoryPicker","layout","shortcuts","remoteAccess"]`
(`:5005-5015`).

```js
// dsh-client-ui-workspace.js:1471-1473
openSession(target) { this.replaceMain(target, this.lifetime.signal, "reveal"); }
```

- **Target**: `SessionTarget = SessionId | SubagentAddress` — a **plain branded string**. *Not* an object.
  Proof: `replaceMain` branches on `typeof target === "string"` (`:1662`).
- **What it does** (`replaceMain`, `:1652-1675`):

```js
replaceMain(target, signal, panel, beforeOpen) {
  signal.throwIfAborted();
  const reference = this.sessions.retain(target, { source: "mainView" });   // ← retains + opens
  try {
    signal.throwIfAborted();
    beforeOpen?.(reference.sessionId);
    if (signal.aborted) { reference.release(); return; }
    const subagentAddress = typeof target === "string" ? this.sessions.subagentAddress(reference.sessionId) : target;
    this.selection.set({ sessionId: reference.sessionId, ...(subagentAddress === undefined ? {} : { subagentAddress }) });
  } catch (error) { reference.release(); throw error; }
  const previous = this.mainReference;
  this.mainReference = reference;
  previous?.release();
  if (panel === "reveal") this.ctx.layout.selectPanel(null);   // closes the right panel
}
```

- **Cross-workspace**: works. `retain` never consults workspace membership; the selection store change makes
  the conversation area render that session. The sidebar does *not* necessarily auto-expand/scroll to the row —
  `revealSessionId` is internal component state set by the sidebar's own reveal path (`:3025-3090`, `:3652`).
- **Archived sessions**: opening works at the retain level, but `watchNavigation` → `clearArchivedCurrent`
  (`:1639-1651`) clears the selection on the next list tick while the id is in
  `workspaces.archivedSessionIds`; the shipped UI refuses to open them and shows a toast instead
  (`:5168-5174`, `notifyArchivedNotOpenable`). So **unarchive first**:

```js
if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
  await ctx.uiWorkspace.unarchiveSession(sessionId);       // :1546-1548
}
ctx.uiWorkspace.openSession(sessionId);
```

- **Focus / activation: none.** `openSession` does not touch `document`, focus, scroll, or the window.
  There is no “activate app then open” helper anywhere in the bundles (see B5b). `clearMain()` (`:1645-1651`)
  deselects.
- Throws if the id cannot be retained (e.g. it was deleted); wrap in `try/catch`.

### B5b. Desktop (Electron) activation from the renderer — **there is none in rc.5**

`globalThis.dshDesktop` is injected by the Electron preload (`app.asar:lib/preload-app.cjs:876`):

```js
electron.contextBridge.exposeInMainWorld("dshDesktop",
  location.protocol === 'dsh-app:' && location.hostname === 'app' && process.isMainFrame
    ? createProductApi() : { protocolVersion: 1 });
```

`createProductApi()` (`preload-app.cjs:789-843`) exposes **only**:

```js
{ protocolVersion: 1,
  browser: { acquire, release },
  deviceInfo(),
  keyboard: { closeWindow(revision), subscribe(listener) },
  shortcuts: { get(definitions), edit(edit, revision), recording(active), subscribe(listener) },
  updates: { status(), open(), subscribe(listener) } }
```

- No `focus` / `show` / `activate` / `restore` / `showInactive` / notification method.
- The private IPC channel table (`preload-app.cjs:5-31`, `:36-42`) has no focus/activate/notification channel.
- Other bridge globals: `__DSH_DIRECTORY_PICKER__`, `__DSH_HOST_PATHS__`, `dshDesktopBoot`, `dshPlatform`,
  `__DSH_LOCALE__`, `dshOnboarding` (`preload-app.cjs:845-879`). None of them focuses the window.
- Electron main does use `Notification` + `flashFrame`, but **only** for the mandatory-update prompt
  (`app.asar:lib/main.js:9706-9720`); there is no session-notification feature to reuse.
- `'dshDesktop' in globalThis` is the rc.5 desktop marker used by official client code
  (`dsh-client-product-analytics.js:20`, `dsh-client-ui-chat.js:13180`) — presence only, no members are read.
- grep over all 76 bundles: `BrowserWindow` 0, `window.focus` 0, `document.hasFocus` 0, `setFocus(` 0,
  `requestPermission` 0, `Notification.permission` 0, `new Notification` 0.

**Conclusion:** a plugin can *navigate* (`uiWorkspace.openSession`) but cannot *foreground* the OS window.
Best effort available from a click handler:

```js
try { window.focus(); } catch { /* no-op */ }
// Chromium focuses the originating document when a page notification is clicked; the desktop
// shell exposes no IPC to force the BrowserWindow to the front.
```

If true “focus DSH” is a hard requirement it needs a shell/preload change (new IPC channel + main-process
`win.show(); win.focus()`), which is out of scope for a client-only module in 0.2.1-rc.5.

### B6. `new Notification()` availability / helpers

- No DSH helper exists: no `Notification.permission` check, no `requestPermission` wrapper, no permission UI
  in any bundle (grep = 0 hits). Nothing in `ctx` is notification-aware.
- The renderer is a normal Chromium document (`apps/web` shell; desktop page origin is `dsh-app://app/`), so
  the platform API `window.Notification` is the only option. Reliability differs:
  - **Web client** (`http://127.0.0.1:59991`): `Notification` exists; `Notification.permission` starts as
    `"default"` and `requestPermission()` must be called from a user gesture. Clicking a notification focuses
    the originating tab/window (browser behavior).
  - **Desktop client**: `Notification` is present, but permission state depends on the Electron/Chromium
    profile and cannot be assumed `"granted"`; there is **no** bridge to the native `Notification` in main.
    Click handling still runs in the renderer.
- Always feature-detect + try/catch, and never let a notification failure break the observation path:

```js
function notificationApi() {
  const Ctor = typeof globalThis.Notification === 'function' ? globalThis.Notification : undefined;
  if (Ctor === undefined) return null;
  return { Ctor, permission: Ctor.permission };   // 'granted' | 'denied' | 'default'
}
async function ensurePermission() {                 // call from a click/keypress only
  const api = notificationApi();
  if (api === null || api.permission !== 'default') return api?.permission ?? 'denied';
  try { return await api.Ctor.requestPermission(); } catch { return 'denied'; }
}
```

---

## C. SETTINGS UI

### C7. `settings.section` slot contract (authoritative text from the client type registry)

`dsh-cordis-client-runner.js:5340-5391`:

```ts
key: "settings.section"
kind: "list"          // additive, one page per entry
scope: "root"
registerOptions: [
  { name: "id",    requirement: "required", type: "string",
    doc: "Your cell key. A fresh id is added beside the shipped entries; reusing a shipped id replaces it." },
  { name: "order", requirement: "optional", type: "number", doc: "Position among the entries, ascending (default 0)." },
  { name: "label", requirement: "optional", type: "string | (() => string)",
    doc: "A thunk is re-read on every projection, so localized text follows the active locale without re-registering." },
]
ownerProps: [`
  export interface SettingsSectionOwnerProps {
    /** Close the settings panel (the shell owns the open state). */
    close: () => void
  }`]
declaredBy: "an entry in 'sidebar.settings' (client-ui-settings-general), so it exists while that entry is mounted"
occupants: [ agent-preset 'agent-presets', settings-account 'account', settings-general 'general',
             settings-models 'models', settings-plugins 'plugins' ]
replaceRisk: "none"
```

Shipped registrations are exactly `{ name, id, order, label }` (`settings-general`, `settings-models`, …);
`ui-settings-models`/`account` additionally pass `store` + `inject` because they own a controller.

**What the renderer/shell does with them.** The shell (settings-general) renders the selected section inside
the content column (`dsh-client-ui-settings-general.js:337`):

```js
children: active !== undefined && renderSlot("settings.section", { close: onClose }, { only: active })
```

and builds the nav from the registry (`:1146-1165`):

```js
rows = ctx.slots.entries("settings.section").map((e) => ({
  id: e.options.id ?? "",
  order: e.options.order ?? 0,
  label: resolveSlotLabel(e.options.label) ?? "",
})).sort((a, b) => a.order - b.order);
```

`resolveSlotLabel` is what makes the `() => string` thunk re-evaluated (also bumped by
`ctx.locale.getSnapshot().revision`). Sections land in `div.AnXs9G_options{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}`
(`:60`), inside `div.AnXs9G_content{flex-direction:column;flex:1;min-width:0}` — i.e. **already padded; do not
add page padding**.

**Fields honored in rc.5.** The `ui-slots` `BaseOptions` is `{ name, id, order, label, priority, key, select,
inject, store, locale, children }` (`SlotCore.register` declaration, `dsh-cordis-client-runner.js:2226`;
`StoredEntry.options` = `{key?, id?, order?, label?, priority?}`, `:2282`). For `settings.section` the
meaningful ones are:

| field | honored | note |
|---|---|---|
| `name` | yes (required) | `'settings.section'` |
| `id` | yes (required for list slots) | nav key + `only` filter |
| `order` | yes | ascending nav position |
| `label` | yes | string or thunk, resolved per projection |
| `locale` | yes | namespace → component receives `t` (see `CurrentVersionRow({ t })`, `:660-665`) |
| `inject` | yes | `() => ({...props})` or `() => ({ hooks: {...} })` |
| `store` | yes | only if you need a per-scope store handle |
| `children` | yes | local sub-slots your component renders |
| `key` / `select` / `priority` | wrong slot kind (`list`) — not used here |

**Props a plain (non-store) section component receives** (composed by the renderer):

```js
{
  close,                  // owner prop from the shell
  renderSlot,             // standard: render a child/local slot
  t,                      // only if `locale` was declared
  ...injected,            // whatever your `inject()` returned
  // + every standard root-scope hook:
  useSessions, useSessionStatus, useSessionRetainInfo, useSessionAccess,
  useWorkspaces, useWorkspaceAccess, useRemoteAccess, useResource, usePanelInfo
}
```

Confirmed by `GeneralSection({ renderSlot })` (`:635-640`), `CurrentVersionRow({ t })` (`:660`),
`DeveloperToolsRow({ useDeveloperTools, setEnabled, t })` (`:690`). The standard-hook list is repeated verbatim
in every slot spec (e.g. `dsh-cordis-client-runner.js:5367-5377`).

**`@deepseek-ai/dsh-client-ui-primitives`** is **not** a boot-graph package — it is a **web-shell seed**
(`.cache/bundle-1.js` `OZ()`): `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
`@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`,
`@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`,
`@deepseek-ai/dsh-client-ui-dockkit`. Therefore:

```js
// ALWAYS resolvable from a ModuleLoader factory (require() → seed branch, dsh-client-modules.js:835)
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
```

Exports observed in rc.5 bundles (union of `_deepseek_ai_dsh_client_ui_primitives.<Name>` uses, 56 files):

- Controls: `Button`, `Switch`, `Checkbox`, `Input`, `SegmentedControl`, `SegmentedTabs`, `Pill`, `Tag`,
  `StateDot`, `ConnectionIndicator`, `DisclosureRow`, `InlineEditor`, `Menu`/`MenuGroup`/`MenuItemButton`/
  `MenuSurface`, `Modal` + `useModalLayer`/`closeTopModal`/`modalSelector`, `Tooltip`, `Toast`,
  `HoverCard`/`HoverCardGroup`, `RiskConfirmation`, `ShortcutKeys`, `TextShimmer`.
- Settings form family: `SettingsForm`, `SettingsFormModel`, `settingsTextField`, `settingsNumberField`,
  `SettingsSecretField`, `SettingsValueField` (used by `ui-settings-shell`: "the shared `SettingsFormModel` of
  ui-primitives").
- Content: `MarkdownText`, `MarkdownDelegateProvider`, `CodeBlock`, `JsonBlock`, `JsonTree`, `DiffBlock`,
  `ReadBlock`, `WriteBlock`, `SearchBlock`, `WebBlock`, `TerminalBlock`, `PathLabel`, `ReferenceChip`,
  `UserTextRun`, `FileTypeIcon`, `ImageLightbox`.
- Helpers: `writeClipboard`, `relativeTime`, `focusWithoutRing`, `isDarwinDesktop`, `pointerModality`,
  `observeComposition`, `useAnchoredPosition`, `useDismissOnOutsidePointer`, `useCodeHighlighter`.
- ~150 `Icon*Regular` glyphs (e.g. `IconSettingsOutlineRegular`, `IconCheckOutlineRegular`).
- **No `Select` primitive was observed.** Official selects are native `<select>` styled with `--dsw-*`
  variables (see `.smp-select` in `src/modules/skills-mcp/client/styles/panel.css:156` and the settings pages).
  Verify at runtime with `Object.keys(require('@deepseek-ai/dsh-client-ui-primitives'))`.

So `Switch`, `Button`, `Modal`, `Tooltip` **are** available and required.

### C8. The official general-settings row — exact DOM + declarations

Source: `DeveloperToolsRow.module.css` inlined at `dsh-client-ui-settings-general.js:668` (verbatim string):

```css
.uYSObG_row {
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  justify-content: space-between; align-items: center; gap: 24px;
  padding: 16px 0; display: flex;
}
.uYSObG_title       { font-size: 14px; line-height: 20px }
.uYSObG_description { color: var(--dsw-alias-label-secondary); margin-top: 4px; font-size: 12px; line-height: 18px }
```

Keyed to the component at `:677-681` (`{ row, title, description }`) and rendered at `:694-723`:

```jsx
<div className={css.row}>
  <div>
    <div className={css.title}>{t('developerTools.title')}</div>
    <div className={css.description}>{t('developerTools.description')}</div>
    {failed && <div role="alert">{t('developerTools.error')}</div>}
  </div>
  <Switch checked={enabled} disabled={busy} label={t('developerTools.title')} onChange={(next) => {…}} />
</div>
```

There is **no exported `SettingsRow`/`SettingsSection` layout primitive** in rc.5 — each row hand-rolls these
three `div`s with its own CSS-module classes. `SettingsForm`/`SettingsFormModel` (primitives) is the frame used
by the *Plugins* pages, not by the General rows.

Also relevant — the last-row divider rule and the section container
(`GeneralSection.module.css`, `:618`, used by `GeneralSection` `:635-640`):

```css
.RmVo8q_section { flex-direction: column; width: 100%; display: flex }
.RmVo8q_section > [data-slot="settings.general.item"] > :last-child { border-bottom: none }
```

`[data-slot]` is the outlet attribute the renderer puts around a slot's entries — the same trick works for our
own `settings.section` children.

**Copyable substitute CSS** (do not target the hash-prefixed names — `uYSObG_`/`RmVo8q_`/`AnXs9G_` are
CSS-module hashes that change per build):

```css
.dshn-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0;
  border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshn-row:last-child{border-bottom:none}
.dshn-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dshn-description{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.dshn-field{box-sizing:border-box;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);
  border-radius:var(--dsw-radius-md);padding:0 10px}
```

Other real tokens seen in the settings chrome (`:60`): `--dsw-alias-bg-layer-2`, `--dsw-radius-panel`,
`--dsw-elevation-prominent`, `--dsw-alias-label-primary/secondary/tertiary`,
`--dsw-alias-interactive-bg-hover`, `--dsw-alias-state-error-primary`, `--dsw-radius-md/sm`,
`--dsw-alias-border-l2/l3`, `--dsw-alias-bg-layer-1`.

### C9. How the toolkit's own skills-mcp panel draws title+subtitle cards

`src/modules/skills-mcp/client/components/card.jsx` is **pure data builders** (`maskEnv`, `maskHeaders`,
`headersText`, `detailNodes`) — *not* a card component. The card view is
`src/modules/skills-mcp/client/views/listCard.jsx`:

```jsx
<li className="smp-card">
  <div className="smp-cardRow">
    <div className="smp-cardMain">
      <div className="smp-cardHead">
        <button className="smp-cardToggle" aria-expanded={isOpen} onClick={onToggle}>
          <Chevron open={isOpen} /><span className="smp-cardIdentity">{identity}</span>
        </button>
        <span className="smp-cardEnd">{statusNode}</span>
      </div>
      {description ? <div className="smp-cardDescription">{description}</div> : null}
    </div>
    <span className="smp-cardActions">{menu}</span>
  </div>
  {isOpen ? <div className="smp-cardDetails"><div className="smp-details">{detailNodes(details,'k')}</div></div> : null}
</li>
```

Class names (`smp-`, defined in `src/modules/skills-mcp/client/styles/panel.css`):
`smp-card`, `smp-cardRow`, `smp-cardMain`, `smp-cardHead`, `smp-cardToggle`, `smp-cardIdentity`,
`smp-cardEnd`, `smp-cardDescription`, `smp-cardActions`, `smp-cardDetails`, `smp-details`,
`smp-detailsKey`, `smp-detailsValue`, `smp-error`, `smp-pending`, `smp-spinner`, `smp-button`, `smp-field`,
`smp-select`, `smp-input`.

The title/subtitle pair to copy (`panel.css:31-35`, `:28-30`):

```css
.smp-cardHead{align-items:center;gap:10px;min-width:0;display:flex}
.smp-cardIdentity{ /* 14px title, truncates */ }
.smp-cardDescription{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.smp-cardMain{flex:1 1 auto;min-width:0;flex-direction:column;gap:4px;display:flex}
```

Wiring (`src/modules/skills-mcp/client/client.js:6-37`) — the closest existing template for our module:

```js
export default function createClient(require) {
  const React = require('react')
  globalThis.__dshReact = React
  const primitives = (() => { try { return require('@deepseek-ai/dsh-client-ui-primitives') } catch { return null } })()
  const Panel = createPanel(React, primitives)
  return {
    inject: ['slots', 'configForms', 'remote', 'remote.pluginInventory'],
    apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'skills-mcp', order: 20,
        label: () => 'Skills & MCP',
        inject: () => ({ form, entryId, inventory }),
      }, Panel))
    },
  }
}
```

---

## D. INTEGRATION

### D10. Which `dsh.client.inject` entries a module needs

Two *different* lists, both required:

1. **Cordis service inject** — on the exported plugin object, drives `ctx.<name>` availability:
   `export const inject = ['slots','locale','sessions','uiSession','uiWorkspace','uiConversation']`.
2. **Package inject** — `package.json` → `dsh.client.inject`, drives **module arrival** so that a
   `require('@deepseek-ai/…')` inside our bundle can succeed (the build externalizes every `@deepseek-ai/*`:
   `scripts/build-client.mjs:75` `external: ['react','react/*','@deepseek-ai/*']`).

Is `require('@deepseek-ai/dsh-client-ui-workspace')` resolvable at runtime? **Yes, if you list it.** Resolution
order in the loader (`dsh-client-modules.js:831-850`):

```js
const require = (spec) => {
  if (this.seed.has(spec)) return this.seed.get(spec);        // platform seeds (react, primitives, ui-slots, …)
  const id = stripClientSuffix(spec);                         // '<pkg>/client' → '<pkg>'
  const record = this.loadCache.get(id);  if (record) return record.exports;
  if (this.factories.has(id)) return this.materialize(id).exports;
  throw new Error(`client-modules: require("${spec}") missed the module table …`);
};
```

and registration happens before our factory runs (`:776-794`):

```js
for (const packageName of row.inject) {
  const dependency = this.graphRows.get(packageName);
  if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);  // load + register
}
await this.arrive(row);
```

So listing a package in `dsh.client.inject`:
- **loads and registers** its factory before ours (guarantee ✔), but does **not** materialize it — the first
  `require` materializes lazily (that is fine, it is synchronous);
- is a **silent no-op if the package is not a boot-graph row** (`graphRows.get(...) === undefined` → skipped),
  and then `require` throws. `@deepseek-ai/dsh-client-ui-primitives` is exactly this case — it is a *seed*, so
  it needs no inject entry at all; the entry we already have is harmless but redundant.

Boot-graph confirmation: `.cache/boot.json` `entries[].id` contains **all** of
`@deepseek-ai/dsh-api-session-controller`, `…-client-ui-session`, `…-client-ui-workspace`,
`…-client-ui-conversation`, `…-client-ui-settings`, `…-client-ui-settings-general`, `…-client-ui-chat`,
`…-client-locale`, `…-client-ui-renderer`, plus `dsh-toolkit` itself.

Need in `dsh.client.inject` for this feature:

```jsonc
"inject": [
  "@deepseek-ai/dsh-client-ui-settings",          // settings domain base (already present)
  "@deepseek-ai/dsh-api-remotes",                 // (already present)
  "@deepseek-ai/dsh-client-ui-renderer",          // (already present)
  "@deepseek-ai/dsh-client-locale",               // (already present)
  "@deepseek-ai/dsh-client-ui-sidebar-right",     // (already present)
  "@deepseek-ai/dsh-client-shortcuts",            // (already present)
  "@deepseek-ai/dsh-api-session-controller",      // ADD  → ctx.sessions
  "@deepseek-ai/dsh-client-ui-session",           // ADD  → ctx.uiSession
  "@deepseek-ai/dsh-client-ui-workspace",         // ADD  → ctx.uiWorkspace
  "@deepseek-ai/dsh-client-ui-conversation"       // ADD  → ctx.uiConversation (chat snapshots)
]
```

`@deepseek-ai/dsh-client-ui-primitives` may be dropped from inject (it is a seed) or kept harmlessly.
`@deepseek-ai/dsh-client-ui-chat` is **not** needed by us (we do not replace chat node renderers), but
`uiConversation.binding(id).target('chat')` only has a builder because `ui-chat` registers
`chatViewDefinition` — and `ui-chat` is unconditionally in the graph, so no inject is required; adding it would
be harmless if we ever want ordering guarantees.

Package name normalization: `require('@deepseek-ai/pkg/client')` and `require('@deepseek-ai/pkg')` are the same
module (`stripClientSuffix`, `:98-100`).

### D11. Current `package.json` audit + what to add

`D:\项目\dsh-toolkit\package.json:23-35` today:

```jsonc
"client": {
  "platform": "web",
  "immediately": true,
  "inject": [
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-client-ui-primitives",   // redundant: seed, not a graph row
    "@deepseek-ai/dsh-api-remotes",
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-sidebar-right",
    "@deepseek-ai/dsh-client-shortcuts"
  ]
}
```

The boot manifest echoes this verbatim (`.cache/boot.json`, `dsh-toolkit` entry, no `external` field). Notes:

- Externalized `@deepseek-ai/*` behaviour: everything becomes a runtime `require()`. Nothing is inlined, so a
  missing `dsh.client.inject` entry surfaces as the loud `require(…) missed the module table` throw at
  materialization — i.e. it fails the whole client half, not just the feature.
- `immediately: true` → our entry is prefetched in the immediate tier
  (`.cache/bundle-1.js` `prefetchImmediateTier`); it does not change dependency guarantees.
- Add the four packages from D10. Do **not** remove `@deepseek-ai/dsh-client-ui-settings` (the slot type owner)
  or `…-dsh-client-locale` (dictionary registration is separate, but the package must be up for `ctx.locale`).
- One client module = one bundle: all of this lives in the existing `dsh-toolkit` entry
  (`src/client/index.js` → `ctx.plugin({...})` per feature). Each sub-plugin's own `inject` array is the
  Cordis service list; there is no per-feature `dsh.client.inject`.

---

## E. Runtime probes (run in the page console to confirm before coding)

```js
// seeds / primitives
Object.keys(require('@deepseek-ai/dsh-client-ui-primitives')).filter(k => /Switch|Button|Modal|Tooltip|Settings|Select/.test(k))
// graph rows
__DSH_BOOT__.entries.map(e => e.id)
// sessions snapshot
const ctx = /* the root ctx is not global; use a plugin's ctx */ null
ctx.sessions.list.getSnapshot()
ctx.sessions.retainInfo(id).getSnapshot()
ctx.uiSession.sessionStatus.getSnapshot()
// notification support
({ has: typeof Notification, perm: typeof Notification === 'function' ? Notification.permission : null, desktop: 'dshDesktop' in globalThis })
```

---

## F. Minimal answer set (what we actually need)

**ctx services + APIs**

| need | service | API |
|---|---|---|
| running/finished edges | `sessions` + `uiSession` | `sessions.list.subscribe/getSnapshot()` (`byId[id].running`, `displayTitle`, `parentId`, `origin`, `retainedBy.mainView`), `uiSession.sessionStatus.getSnapshot()/.subscribe()` → `{running, pendingInteraction, completionUnread}` |
| session identity for click | `sessions` | `retain(id,{source:'controllerOperation'})`, `retainInfo(id)`, `using(id,opts,fn)`, `binding(id)` |
| chat text (best effort) | `uiConversation` | `binding(id)` → `activate('chat')` → `target('chat').getSnapshot()` |
| navigate on click | `uiWorkspace` | `openSession(sessionId)` (+ `unarchiveSession(id)` when archived; no window focus exists) |
| settings page | `slots` + `locale` | `ctx.slots.inject('settings.section', () => ctx.slots.register({name,id,order,label,locale}, C))` |
| look | `require('@deepseek-ai/dsh-client-ui-primitives')` | `Switch`, `Button`, `Modal`, `Tooltip`; copy the row CSS by hand |
| notify | platform | `window.Notification` guarded; no DSH helper |

**Exact chat-node extraction** — see the `readChatDigest()` block in §A3 (retain → `uiConversation.binding` →
`activate('chat')` → `target('chat').getSnapshot()` → `snapshot.order.map(k => snapshot.nodes.get(k))` →
`assistant-step.data.blocks.filter(b => b.kind==='text')`, `user.data.content.filter(b => b.type==='text')`,
`turn-error.data.message/seq`).

**Exact notification-click snippet**

```js
// module scope: cordis inject ['sessions','uiSession','uiWorkspace','uiConversation','slots','locale']
const NOTIFY_SOURCE = 'dsh-notification'   // do NOT use 'mainView'

function showCompletionNotification(ctx, sessionId) {
  const Ctor = globalThis.Notification
  if (typeof Ctor !== 'function' || Ctor.permission !== 'granted') return   // never prompt unasked
  const status = ctx.uiSession.sessionStatus.getSnapshot().get(sessionId)
  if (status?.running === true) return
  const row = ctx.sessions.list.getSnapshot().byId[sessionId]
  const title = row?.displayTitle ?? String(sessionId)
  const pending = status?.pendingInteraction
  const body = pending?.kind === 'approval' ? 'Waiting for approval'
    : pending?.kind === 'plan-review' ? 'Plan ready for review'
    : pending?.kind === 'question' ? 'Waiting for your answer'
    : 'Finished'
  let notification
  try {
    notification = new Ctor(title, { body, tag: `dsh-session:${sessionId}` })
  } catch { return }
  notification.onclick = () => {
    try { window.focus() } catch {}                       // best effort; desktop has no activate IPC
    try {
      if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
        ctx.uiWorkspace.unarchiveSession(sessionId)
          .then(() => ctx.uiWorkspace.openSession(sessionId))
          .catch(() => {})
      } else {
        ctx.uiWorkspace.openSession(sessionId)            // SessionTarget = branded string
      }
    } catch {}
    try { notification.close() } catch {}
  }
}
```

**Wire-up shape**

```js
export const inject = ['slots', 'locale', 'sessions', 'uiSession', 'uiWorkspace', 'uiConversation']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('dsh-notification', { zh, en }), 'dsh-notification:dictionary')
  const t = ctx.locale.bind('dsh-notification')

  // settings page
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-notification', order: 30,
    label: () => t('nav'), locale: 'dsh-notification',
    inject: () => ({ useEnabled, setEnabled }),     // your own preference source
  }, NotificationSection)), 'dsh-notification:section')

  // running/finished edges
  let previous = new Map()
  const stop = ctx.uiSession.sessionStatus.subscribe(() => {
    const snapshot = ctx.uiSession.sessionStatus.getSnapshot()
    for (const [sessionId, status] of snapshot) {
      const before = previous.get(sessionId)
      const finished = status.running === false && before?.running === true
      if (finished && ctx.sessions.list.getSnapshot().byId[sessionId]?.retainedBy?.mainView === undefined) {
        showCompletionNotification(ctx, sessionId)
      }
    }
    previous = new Map(snapshot)
  })
  ctx.effect(() => stop, 'dsh-notification:edges')
}
```
