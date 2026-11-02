// src/identity.js
var NAME = "dsh-skills-mcp-manager";

// src/mcp/connection.js
var CONNECTION_BOUNDS = Object.freeze({
  initialDelayMs: Object.freeze({ min: 1, max: 2147483647 }),
  maxDelayMs: Object.freeze({ min: 1, max: 2147483647 }),
  maxAttempts: Object.freeze({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  toolCallTimeoutMs: Object.freeze({ min: 1, max: 2147483647 })
});
var CONNECTION_DEFAULTS = Object.freeze({
  failOnStartupError: false,
  initialDelayMs: 500,
  maxDelayMs: 3e4,
  maxAttempts: 10,
  toolCallTimeoutMs: 6e4
});
var CONNECTION_DRAFT_DEFAULTS = Object.freeze({
  reconnectInitialDelayMs: String(CONNECTION_DEFAULTS.initialDelayMs),
  reconnectMaxDelayMs: String(CONNECTION_DEFAULTS.maxDelayMs),
  reconnectMaxAttempts: String(CONNECTION_DEFAULTS.maxAttempts),
  toolCallTimeoutMs: String(CONNECTION_DEFAULTS.toolCallTimeoutMs),
  /**
   * 明文 token 端点的例外默认为 **false**，与数字字段不同：数字要有「客户端默认值」可以
   * 对齐，而这个开关的默认就是不放宽安全。所以这里放布尔而不是字符串。
   */
  allowInsecureTokenEndpoint: false
});
var RECONNECT_FIELDS = Object.freeze({
  reconnectInitialDelayMs: "initialDelayMs",
  reconnectMaxDelayMs: "maxDelayMs",
  reconnectMaxAttempts: "maxAttempts"
});

// lib/src/importSources.js
var IMPORT_CHOICES = [
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["chatgpt", "ChatGPT"],
  ["cursor", "Cursor"],
  ["gemini", "Gemini CLI"],
  ["antigravity", "Google Antigravity"],
  ["reasonix", "Reasonix"],
  ["opencode", "opencode"],
  ["mimocode", "MimoCode"],
  ["teleagent", "TeleAgent"],
  ["kilo", "Kilo Code"],
  ["zcode", "ZCode"],
  ["grok", "Grok"],
  ["openclaw", "OpenClaw"],
  ["pi", "Pi"],
  ["hermes", "Hermes"],
  ["kimi", "KIMI"],
  ["qoder", "Qoder"],
  ["workbuddy", "WorkBuddy"],
  ["qwen", "Qwen"],
  ["continue", "Continue"],
  ["cline", "Cline"],
  ["goose", "goose"],
  ["zed", "Zed"],
  ["crush", "Crush"],
  // Host 的表格里一直有 vscode（`.vscode/mcp.json` / 用户级 mcp.json），
  // 只是这份下拉漏了它 —— 补上，否则这个来源在面板里根本选不到。
  ["vscode", "VS Code"]
];

// lib/src/config.js
function snapshotOf(form) {
  const snapshot = form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot;
  return snapshot?.value ?? snapshot ?? {};
}
function statusOf(form) {
  const snapshot = form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot;
  return snapshot?.status ?? "ready";
}

// lib/src/components/chevron.jsx
function Chevron({ open }) {
  return /* @__PURE__ */ __dshReact.createElement(
    "svg",
    {
      className: "smp-chevron",
      "data-open": String(open),
      width: 16,
      height: 16,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true"
    },
    /* @__PURE__ */ __dshReact.createElement(
      "path",
      {
        d: "M4 6l4 4 4-4",
        stroke: "currentColor",
        strokeWidth: 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      }
    )
  );
}

// lib/src/components/field.jsx
function field(label, control, wide) {
  return /* @__PURE__ */ __dshReact.createElement("label", { className: "smp-field", key: label, "data-wide": Boolean(wide) }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-label", key: "l" }, label), control);
}

// lib/src/components/filterRow.jsx
function filterRow({ query, onQuery, placeholder, actions = null }) {
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-filterRow", key: "filter" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-search", key: "search" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-searchIcon", key: "i" }, /* @__PURE__ */ __dshReact.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ __dshReact.createElement(
    "path",
    {
      d: "M7 12a5 5 0 100-10 5 5 0 000 10zm3.5-1.5L14 14",
      stroke: "currentColor",
      strokeWidth: 1.3,
      strokeLinecap: "round"
    }
  ))), /* @__PURE__ */ __dshReact.createElement(
    "input",
    {
      className: "smp-searchInput",
      key: "in",
      placeholder,
      value: query,
      onChange: (event) => onQuery(event.target.value)
    }
  )), actions);
}

// lib/src/components/filters.js
function matchesName(name, query) {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle === "") return true;
  if (typeof name !== "string") return false;
  return name.toLowerCase().includes(needle);
}
function tabLabel(title, count) {
  return `${title}\uFF08${count}\uFF09`;
}

// lib/src/components/tabs.jsx
var TAB_ITEMS = [
  { id: "mcp", title: "MCP" },
  { id: "skills", title: "Skills" }
];
function tabStrip({ active, counts = {}, onSelect }) {
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-tabs", key: "tabs" }, TAB_ITEMS.map((item) => /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      key: item.id,
      className: "smp-tab",
      "data-active": active === item.id,
      onClick: () => onSelect(item.id)
    },
    tabLabel(item.title, counts[item.id] ?? 0)
  )));
}

// lib/src/components/head.jsx
var PAGE_TITLE = "Skills & MCP";
var PAGE_INTRO = "\u5168\u5C40\u4E0E\u9879\u76EE\u7EA7\u5206\u5C42\u7BA1\u7406\uFF1B\u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\u3002";
function pageHead() {
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-pageHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement("div", { key: "text" }, /* @__PURE__ */ __dshReact.createElement("h2", { className: "smp-pageTitle", key: "h" }, PAGE_TITLE), /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-pageIntro", key: "p" }, PAGE_INTRO)));
}

// lib/src/components/scopeOrder.js
function scopeKey(scope) {
  if (typeof scope !== "string" || scope === "" || scope === "global") return "";
  return scope;
}
function orderedScopeGroups(items = [], workspacePaths = [], pendingScopes = []) {
  const list = Array.isArray(items) ? items : [];
  const buckets = /* @__PURE__ */ new Map();
  const firstSeen = [];
  const bucket = (scope) => {
    if (!buckets.has(scope)) {
      buckets.set(scope, []);
      firstSeen.push(scope);
    }
    return buckets.get(scope);
  };
  for (const item of list) bucket(scopeKey(item?.scope)).push(item);
  for (const scope of Array.isArray(pendingScopes) ? pendingScopes : []) bucket(scopeKey(scope));
  const known = [];
  for (const path of Array.isArray(workspacePaths) ? workspacePaths : []) {
    const scope = scopeKey(path);
    if (scope !== "" && !known.includes(scope)) known.push(scope);
  }
  const groups = [];
  const taken = /* @__PURE__ */ new Set();
  for (const scope of ["", ...known, ...firstSeen]) {
    if (taken.has(scope)) continue;
    const found = buckets.get(scope);
    if (found === void 0) continue;
    taken.add(scope);
    groups.push({ scope, items: found });
  }
  return groups;
}

// lib/src/crud/inflight.js
var DEFAULT_TIMEOUT = 15e3;
var UPDATE_GRACE = 4e3;
function pendingLabel(info) {
  switch (info?.kind) {
    case "delete":
      return "\u5220\u9664\u4E2D\u2026";
    case "toggle":
      return "\u5207\u6362\u4E2D\u2026";
    case "add":
      return "\u6B63\u5728\u5199\u5165\u914D\u7F6E\u6587\u4EF6\u2026";
    default:
      return "\u4FDD\u5B58\u4E2D\u2026";
  }
}
function hasSettled(info, row, now = Date.now()) {
  const age = now - (info?.at ?? now);
  switch (info?.kind) {
    case "delete":
      return row === void 0;
    // 行已消失（例如被别处删掉）时该操作已无意义，直接算完成，免得空转
    case "toggle":
      return row === void 0 || row.enabled === info.expectEnabled;
    case "add":
      return row !== void 0;
    case "update":
      return row !== void 0 && (row.serverName === info.expectName || age > UPDATE_GRACE);
    default:
      return true;
  }
}
function bareId(value) {
  return String(value ?? "").replace(/^include:/, "");
}
function settleInflight(map = {}, { profileRows = [], now = Date.now(), timeout = DEFAULT_TIMEOUT } = {}) {
  const entries = Object.entries(map);
  if (entries.length === 0) return map;
  const known = new Set(profileRows.map((candidate) => bareId(candidate?.entryId)));
  const kept = {};
  for (const [entryId, info] of entries) {
    const row = known.has(bareId(entryId)) ? profileRows.find((candidate) => bareId(candidate?.entryId) === bareId(entryId)) : void 0;
    if (hasSettled(info, row, now)) continue;
    if (now - (info?.at ?? now) >= timeout) continue;
    kept[entryId] = info;
  }
  return Object.keys(kept).length === entries.length ? map : kept;
}
function pendingAdds(map = {}, profileRows = []) {
  const known = new Set(profileRows.map((row) => bareId(row?.entryId)));
  return Object.entries(map).filter(([entryId, info]) => info.kind === "add" && !known.has(bareId(entryId)));
}

// lib/src/components/sections.js
function emptySkillText(label) {
  const name = typeof label === "string" ? label.trim() : "";
  if (name === "") return "\u8FD8\u6CA1\u6709\u6280\u80FD \u2014\u2014 \u70B9\u4E0A\u9762\u300C\u6DFB\u52A0\u6280\u80FD\u300D\uFF0C\u4FDD\u5B58\u540E\u5199\u5165\u78C1\u76D8\u3002";
  return `${name} \u8FD8\u6CA1\u6709\u6280\u80FD \u2014\u2014 \u70B9\u4E0A\u9762\u300C\u6DFB\u52A0\u6280\u80FD\u300D\uFF0C\u6216\u5207\u5230\u5176\u4ED6\u5DE5\u4F5C\u533A\u3002`;
}
function emptyMcpText(label) {
  const name = typeof label === "string" ? label.trim() : "";
  if (name === "") return "\u8FD8\u6CA1\u6709 MCP \u670D\u52A1\u5668 \u2014\u2014 \u53EF\u4EE5\u70B9\u300C\u6DFB\u52A0\u670D\u52A1\u5668\u300D\uFF0C\u6216\u7528\u300C\u5BFC\u5165 MCP\u300D\u4ECE\u5176\u4ED6\u5DE5\u5177\u5BFC\u5165\u3002";
  return `${name} \u8FD8\u6CA1\u6709 MCP \u670D\u52A1\u5668 \u2014\u2014 \u53EF\u4EE5\u70B9\u300C\u6DFB\u52A0\u670D\u52A1\u5668\u300D\uFF0C\u6216\u7528\u300C\u5BFC\u5165 MCP\u300D\u4ECE\u5176\u4ED6\u5DE5\u5177\u5BFC\u5165\u3002`;
}

// lib/src/components/form.js
var HINTS = {
  serverName: "\u4F8B\u5982 context7\uFF0C\u6700\u591A 32 \u5B57\u7B26",
  command: "npx",
  args: "-y @scope/pkg@latest",
  env: "TEST_TOKEN=sk-xxxxxxx\n\u591A\u4E2A\u53D8\u91CF\u4E00\u884C\u4E00\u4E2A\uFF0C\u4F8B\u5982\uFF1A\nAPI_KEY=sk-abc\nREGION=cn",
  url: "https://\u2026/mcp",
  headers: "Authorization=Bearer sk-xxxxxxx\n\u591A\u4E2A\u8BF7\u6C42\u5934\u4E00\u884C\u4E00\u4E2A\uFF0C\u7528\u7B49\u53F7\u8FDE\u63A5\uFF08\u4E0E Host \u7684\u89E3\u6790\u4E00\u81F4\uFF09",
  project: "\u8BF7\u9009\u62E9\u9879\u76EE"
};

// lib/src/components/card.jsx
function maskEnv(env) {
  if (typeof env !== "string" || env.trim() === "") return "\u2014";
  return env.replace(/=.*/g, "=***");
}
function maskHeaders(headers) {
  const text2 = headersText(headers);
  if (text2.trim() === "") return "\u2014";
  return text2.replace(/([=:])[^\n]*/g, "$1***");
}
function headersText(headers) {
  if (headers === null || headers === void 0) return "";
  if (typeof headers === "string") return headers;
  if (typeof headers !== "object") return "";
  return Object.entries(headers).map(([key, value]) => `${key}: ${String(value)}`).join("\n");
}
function splitEnv(env) {
  const text2 = typeof env === "string" ? env : "";
  const own = [];
  let path = "";
  for (const line of text2.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim();
    if (key.toUpperCase() === "PATH") path = trimmed.slice(at + 1).trim();
    else own.push(trimmed);
  }
  return { own: own.join("\n"), path };
}
function hasInjectedPath(env) {
  return splitEnv(env).path !== "";
}
function transportPairs(transport, values) {
  if (transport === "stdio") {
    const pairs2 = [["\u547D\u4EE4", values.command || "\u2014"]];
    if (values.args !== "") pairs2.push(["\u53C2\u6570", values.args]);
    const { own, path } = splitEnv(values.env);
    if (own !== "") pairs2.push(["\u73AF\u5883\u53D8\u91CF", maskEnv(own)]);
    if (path !== "") pairs2.push(["PATH", "DSH \u81EA\u52A8\u6CE8\u5165 \xB7 \u8DDF\u968F\u7CFB\u7EDF PATH\uFF0C\u8BA9 npx/node \u80FD\u88AB\u627E\u5230"]);
    return pairs2;
  }
  const pairs = [["\u5730\u5740", values.url || "\u2014"]];
  if (values.headers !== "") pairs.push(["\u8BF7\u6C42\u5934", maskHeaders(values.headers)]);
  return pairs;
}
function rowDetailPairs(row = {}) {
  const transport = row.transport || "streamable-http";
  return [
    ["\u884C id", String(row.entryId ?? "").replace(/^include:/, "")],
    ["\u4F20\u8F93", transport],
    ...transportPairs(transport, {
      // For a stdio row the projection merges command + args into `target`.
      command: transport === "stdio" ? row.target || "" : "",
      args: row.args ?? "",
      env: row.env ?? "",
      url: transport === "stdio" ? "" : row.target || "",
      headers: row.headersText ?? ""
    }),
    // The scope *is* the tier now: `global` means the Loader connects this row and every
    // agent sees it; an absolute path means this plugin mounts it for the agent whose
    // working directory falls under it. One row, one list — so the card states which.
    ["\u4F5C\u7528\u57DF", scopeLabelOf(row.scope)]
    // 没有「状态」行：卡片右侧的开关就是启用状态的唯一真源。再写一行字等于同一件事有
    // 两个出处，而它们会漂移（开关是乐观更新的，文字来自投影，中间必然有一段时间不一致）。
  ];
}
function scopeLabelOf(scope) {
  const value = typeof scope === "string" ? scope : "";
  if (value === "" || value === "global") return "\u5168\u5C40";
  return value;
}
function detailNodes(pairs, keyPrefix = "d") {
  return pairs.flatMap(([key, value]) => [
    /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-detailsKey", key: `${keyPrefix}-k-${key}` }, key),
    /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-detailsValue", key: `${keyPrefix}-v-${key}` }, value || "\u2014")
  ]);
}
var TOOL_ERROR_REASONS = {
  /** The Host published no error field: it is an older build than this panel. */
  hostStale: "host-stale",
  /** The Host reported a concrete failure while reading the registry. */
  reported: "reported"
};
var REASON_TEXT = {
  "loading": "\u6B63\u5728\u8BFB\u53D6\u5F53\u524D\u5DE5\u5177\u6E05\u5355",
  "runtime-unavailable": "\u65E0\u6CD5\u8BFB\u53D6 Host \u8FD0\u884C\u65F6\u6570\u636E\uFF08\u8BF7\u786E\u8BA4 Host \u5DF2\u66F4\u65B0\u4E14\u8FDE\u63A5\u6B63\u5E38\uFF09",
  "lookup-failed": "\u65E0\u6CD5\u8BBF\u95EE\u5DE5\u5177\u670D\u52A1\uFF08cordis \u670D\u52A1\u5C1A\u672A\u6CE8\u5165\uFF09",
  "service-missing": "\u5F53\u524D\u914D\u7F6E\u91CC\u6CA1\u6709\u5DE5\u5177\u6CE8\u518C\u8868\uFF08dsh-tools \u672A\u6302\u8F7D\uFF09",
  "api-missing": "\u5DE5\u5177\u6CE8\u518C\u8868\u7248\u672C\u8FC7\u65E7\uFF0C\u6CA1\u6709 schemas() \u63A5\u53E3",
  "read-failed": "\u8BFB\u53D6\u5DE5\u5177\u6CE8\u518C\u8868\u51FA\u9519",
  "bad-shape": "\u5DE5\u5177\u6CE8\u518C\u8868\u8FD4\u56DE\u4E86\u610F\u5916\u7684\u6570\u636E\u5F62\u72B6"
};
function toolsForServer(serverTools, serverName, serverToolsError = void 0) {
  const listed = Array.isArray(serverTools) ? serverTools : [];
  const entry = listed.find((item) => item?.serverName === serverName);
  if (entry !== void 0) {
    return { state: "listed", tools: Array.isArray(entry.tools) ? entry.tools : [] };
  }
  if (serverToolsError === void 0 || serverToolsError === null) {
    return { state: "unreadable", kind: TOOL_ERROR_REASONS.hostStale, reason: "", detail: "" };
  }
  const reason = serverToolsError.reason;
  if (typeof reason === "string" && reason !== "") {
    return { state: "unreadable", kind: TOOL_ERROR_REASONS.reported, reason, detail: String(serverToolsError.detail ?? "") };
  }
  return { state: "absent" };
}
function toolsSummary(inventory) {
  if (inventory?.state === "listed") {
    if (inventory.tools.length === 0) return "\u6682\u65E0\u5DF2\u6CE8\u518C\u7684\u5DE5\u5177\uFF08\u53EF\u80FD\u672A\u8FDE\u63A5\u6216\u8BE5\u670D\u52A1\u5668\u6CA1\u6709\u5DE5\u5177\uFF09";
    return `${inventory.tools.length} \u4E2A\u5DE5\u5177`;
  }
  if (inventory?.state === "absent") return "\u5C1A\u672A\u53D1\u5E03\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\uFF08\u521A\u6DFB\u52A0\u7684\u8BDD\u7A0D\u7B49\u7247\u523B\uFF09";
  if (inventory?.kind === TOOL_ERROR_REASONS.hostStale) {
    return "\u9700\u8981\u91CD\u542F DSH \u540E\u53EF\u89C1\uFF08\u5F53\u524D\u8FD0\u884C\u7684 Host \u662F\u65E7\u7248\u672C\uFF09";
  }
  const text2 = REASON_TEXT[inventory?.reason];
  if (text2 === void 0) return "\u5DE5\u5177\u6E05\u5355\u4E0D\u53EF\u8BFB";
  return inventory?.detail ? `${text2}\uFF1A${inventory.detail}` : text2;
}

// lib/src/components/menuAnchor.js
var ITEM_HEIGHT_PX = 30;
var CHROME_HEIGHT_PX = 10;
var EDGE_PX = 8;
var GAP_PX = 4;
function measureMenuAnchor({ rect, itemCount, viewportWidth, viewportHeight } = {}) {
  if (rect === void 0 || rect === null) return null;
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  const right = Number(rect.right);
  const width = Number(viewportWidth);
  const height = Number(viewportHeight);
  if (![top, bottom, right, width, height].every((value) => Number.isFinite(value))) return null;
  if (width <= 0 || height <= 0) return null;
  const estimated = Math.max(0, Number(itemCount) || 0) * ITEM_HEIGHT_PX + CHROME_HEIGHT_PX;
  const spaceBelow = height - bottom - EDGE_PX;
  const spaceAbove = top - EDGE_PX;
  const placement = spaceBelow >= estimated || spaceBelow >= spaceAbove ? "down" : "up";
  return {
    // 右对齐到触发按钮：菜单在按钮左下方展开，是这一列操作的常见位置。
    right: Math.max(EDGE_PX, width - right),
    top: Math.round(bottom + GAP_PX),
    bottom: Math.round(height - top + GAP_PX),
    placement,
    // 两边都不够时，让菜单自己滚动而不是被切掉。
    maxHeight: Math.max(0, placement === "up" ? spaceAbove : spaceBelow)
  };
}
function anchorStyle(anchor) {
  if (anchor === null || anchor === void 0) return void 0;
  const style = {
    position: "fixed",
    right: `${String(anchor.right)}px`,
    maxHeight: `${String(anchor.maxHeight)}px`,
    overflowY: "auto"
  };
  if (anchor.placement === "up") {
    style.bottom = `${String(anchor.bottom)}px`;
    style.top = "auto";
  } else {
    style.top = `${String(anchor.top)}px`;
    style.bottom = "auto";
  }
  return style;
}

// src/mcp/oauth/channel.js
var AUTH_CHANNEL = "dsh-skills-mcp-manager/oauth";
var AUTH_DONE = "authorized";

// lib/src/components/toolList.jsx
function normalizeDescription(text2) {
  return String(text2 ?? "").replace(/\s+/g, " ").trim();
}
function toolListNode(inventory, keyPrefix = "tools", filter = null) {
  const head = (trailing, tone) => /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-toolHead", key: keyPrefix }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-toolTitle" }, "\u5DE5\u5177"), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-toolCount", "data-tone": tone }, trailing));
  if (inventory?.state !== "listed") return head(`\xB7 ${toolsSummary(inventory)}`, "muted");
  const { tools } = inventory;
  if (tools.length === 0) return head(`\xB7 ${toolsSummary(inventory)}`, "muted");
  const selected = new Set(Array.isArray(filter?.tools) ? filter.tools : []);
  const mode = filter?.mode === "allow" || filter?.mode === "deny" ? filter.mode : "off";
  const editMode = filter !== null && filter !== void 0;
  const canEdit = editMode && filter.onMode !== void 0;
  const picking = canEdit && mode !== "off";
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-tools", key: keyPrefix }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-toolHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-toolTitle" }, "\u5DE5\u5177"), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-toolCount" }, `(${tools.length})`), canEdit ? /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-toolModes", key: "modes" }, [["off", "\u5168\u90E8\u4FDD\u7559"], ["allow", "\u53EA\u4FDD\u7559\u52FE\u9009"], ["deny", "\u53EA\u6321\u52FE\u9009"]].map(([value, label]) => /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      key: value,
      className: "smp-toolMode",
      "data-active": String(mode === value),
      onClick: () => filter.onMode(value)
    },
    label
  ))) : null), picking ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "hint" }, mode === "allow" ? `\u52FE\u9009\u8981\u4FDD\u7559\u7684\u5DE5\u5177\uFF08${selected.size}/${tools.length}\uFF09\u2014\u2014\u6CA1\u52FE\u7684\u4E0D\u4F1A\u6CE8\u518C\u7ED9\u6A21\u578B\u3002` : `\u52FE\u9009\u8981\u6321\u6389\u7684\u5DE5\u5177\uFF08${selected.size}/${tools.length}\uFF09\u2014\u2014\u5176\u4F59\u7167\u5E38\u6CE8\u518C\u3002`) : null, /* @__PURE__ */ __dshReact.createElement("ul", { className: "smp-toolList" }, tools.map((tool) => {
    const description = normalizeDescription(tool.description);
    const shown = picking && filter.leafOf !== void 0 ? filter.leafOf(tool.name) : tool.name;
    const checked = selected.has(shown);
    const kept = mode === "deny" ? !checked : checked;
    return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-tool", key: tool.name, "data-kept": picking ? String(kept) : void 0 }, picking ? /* @__PURE__ */ __dshReact.createElement("label", { className: "smp-toolPick", key: "pick" }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        type: "checkbox",
        checked,
        onChange: (event) => filter.onToggle(shown, event.target.checked)
      }
    ), /* @__PURE__ */ __dshReact.createElement("code", { className: "smp-toolName", title: tool.name }, shown)) : /* @__PURE__ */ __dshReact.createElement("code", { className: "smp-toolName", title: tool.name }, shown), description === "" ? null : (
      // `title` carries the full text: the CSS clamp trims only the visual
      // box, so hovering still reveals everything a long description says.
      /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-toolDesc", title: description }, description)
    ));
  })));
}

// lib/src/components/dialog.jsx
function deleteConfirmDialog({ dialog, primitives, onCancel, onConfirm, pending = false, error = "" }) {
  if (dialog === null || dialog === void 0) return null;
  const Modal = primitives?.Modal;
  if (Modal === void 0) return null;
  const Button = primitives.Button ?? "button";
  return /* @__PURE__ */ __dshReact.createElement(
    Modal,
    {
      open: true,
      onClose: onCancel,
      title: `\u5220\u9664\u300C${dialog.label}\u300D\uFF1F`,
      closeLabel: "\u5173\u95ED",
      description: /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-deleteMeta", key: "meta" }, /* @__PURE__ */ __dshReact.createElement("div", { key: "note" }, dialog.note), error !== "" ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-error", key: "err", style: { marginTop: 6 } }, error) : null, pending ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-pendingHint", key: "pending" }, "\u6B63\u5728\u5220\u9664\u5E76\u5237\u65B0\u5217\u8868\u2026") : null),
      footer: /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement(Button, { variant: "outline", key: "cancel", onClick: onCancel, disabled: pending }, "\u53D6\u6D88"), /* @__PURE__ */ __dshReact.createElement(Button, { variant: "primary", key: "ok", onClick: onConfirm, disabled: pending }, pending ? "\u5220\u9664\u4E2D\u2026" : "\u5220\u9664"))
    }
  );
}

// lib/src/components/skillPreview.jsx
function skillPreviewDialog({ skill, body = "", pending = false, primitives, onClose }) {
  if (skill === null || skill === void 0) return null;
  const Modal = primitives?.Modal;
  if (Modal === void 0) return null;
  const tag = String(skill.source ?? "").endsWith("-agents") ? "agents" : "dsh";
  return /* @__PURE__ */ __dshReact.createElement(
    Modal,
    {
      open: true,
      onClose,
      title: `${skill.name ?? ""}\uFF08${tag}\uFF09`,
      closeLabel: "\u5173\u95ED",
      description: /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-previewMeta", key: "meta" }, String(skill.description ?? "").trim() !== "" ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-previewDesc", key: "desc" }, skill.description) : null, skill.path ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-previewPath", key: "path" }, `\u6587\u4EF6\uFF1A${skill.path}`) : null)
    },
    /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-previewWrap", key: "wrap" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-preview", key: "body" }, pending ? "\u8BFB\u53D6\u4E2D\u2026" : body !== "" ? body : skill.body ?? ""))
  );
}

// lib/src/components/skillDialog.jsx
function skillDialogView({
  dialog,
  draft,
  workspaceChoices = [],
  resolvedPath = "",
  error = "",
  pending = false,
  primitives,
  onScope,
  onProject,
  onProjectCustom,
  onRoot,
  onName,
  onDescription,
  onBody,
  onCancel,
  onSave
}) {
  if (dialog === null || dialog === void 0) return null;
  const Modal = primitives?.Modal;
  if (Modal === void 0) return null;
  const Button = primitives.Button ?? "button";
  const isEdit = dialog.mode === "edit";
  const isProject = dialog.scope === "project";
  const custom = dialog.projectCustom === true;
  return /* @__PURE__ */ __dshReact.createElement(
    Modal,
    {
      open: true,
      onClose: onCancel,
      closeLabel: "\u5173\u95ED",
      title: isEdit ? `\u7F16\u8F91\u6280\u80FD\u300C${dialog.prevName}\u300D` : "\u6DFB\u52A0\u6280\u80FD",
      description: isEdit ? "\u5C42\u7EA7\u3001\u5DE5\u4F5C\u533A\u4E0E\u76EE\u5F55\u90FD\u4E0D\u53EF\u4FEE\u6539\u3002\u6539\u540D\u4F1A\u540C\u65F6\u79FB\u52A8\u76EE\u5F55\u5E76\u91CD\u5199 SKILL.md \u91CC\u7684 name\uFF08\u539F\u76EE\u5F55\u4F1A\u5148\u5907\u4EFD\uFF09\u3002" : "\u9009\u62E9\u5C42\u7EA7\u4E0E\u76EE\u5F55\u540E\u5199\u5165 <\u76EE\u6807\u76EE\u5F55>/<\u540D\u5B57>/SKILL.md\uFF1B\u76EE\u5F55\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\u3002",
      footer: /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement(Button, { variant: "outline", key: "cancel", onClick: onCancel }, "\u53D6\u6D88"), /* @__PURE__ */ __dshReact.createElement(Button, { variant: "primary", key: "save", disabled: pending, onClick: onSave }, pending ? "\u4FDD\u5B58\u4E2D\u2026" : isEdit ? "\u4FDD\u5B58" : "\u521B\u5EFA"))
    },
    /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-skillDialogBody", key: "body" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-formGrid", key: "grid" }, field("\u5C42\u7EA7", /* @__PURE__ */ __dshReact.createElement(
      "select",
      {
        className: "smp-select",
        value: dialog.scope,
        disabled: isEdit,
        onChange: (event) => onScope(event.target.value)
      },
      /* @__PURE__ */ __dshReact.createElement("option", { value: "global", key: "g" }, "\u5168\u5C40 \u2014\u2014 \u6240\u6709\u5DE5\u4F5C\u533A\u90FD\u80FD\u7528"),
      /* @__PURE__ */ __dshReact.createElement("option", { value: "project", key: "p" }, "\u9879\u76EE\u7EA7 \u2014\u2014 \u53EA\u5728\u67D0\u4E2A\u5DE5\u4F5C\u533A")
    )), !isProject ? null : field("\u5DE5\u4F5C\u533A", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-scopePick", key: "workspace" }, /* @__PURE__ */ __dshReact.createElement(
      "select",
      {
        className: "smp-select",
        key: "sel",
        disabled: isEdit,
        value: custom ? "__custom__" : dialog.project ?? "",
        onChange: (event) => onProject(event.target.value)
      },
      /* @__PURE__ */ __dshReact.createElement("option", { value: "", key: "none" }, "\u8BF7\u9009\u62E9\u5DE5\u4F5C\u533A"),
      workspaceChoices.map(([path, title]) => /* @__PURE__ */ __dshReact.createElement("option", { value: path, key: path }, title)),
      /* @__PURE__ */ __dshReact.createElement("option", { value: "__custom__", key: "custom" }, "\u81EA\u5B9A\u4E49\u8DEF\u5F84\u2026")
    ), !custom ? null : /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "smp-input",
        key: "custom",
        disabled: isEdit,
        placeholder: "\u5DE5\u4F5C\u533A\u7EDD\u5BF9\u8DEF\u5F84",
        value: dialog.project ?? "",
        onChange: (event) => onProjectCustom(event.target.value)
      }
    )), true), field("\u76EE\u5F55", /* @__PURE__ */ __dshReact.createElement(
      "select",
      {
        className: "smp-select",
        value: dialog.id === "agents" ? "agents" : "dsh",
        disabled: isEdit,
        onChange: (event) => onRoot(event.target.value)
      },
      /* @__PURE__ */ __dshReact.createElement("option", { value: "dsh", key: "d" }, ".dsh/skills"),
      /* @__PURE__ */ __dshReact.createElement("option", { value: "agents", key: "a" }, ".agents/skills")
    )), resolvedPath === "" ? null : (
      // `.smp-skillPath` spans both grid columns (it is not a `.smp-field`, so the
      // `data-wide` convention does not apply to it).
      /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note smp-skillPath", key: "resolved" }, `\u5C06\u5199\u5165 ${resolvedPath}/<\u540D\u5B57>/SKILL.md`)
    ), field("\u540D\u79F0\uFF08\u4F1A\u6210\u4E3A\u76EE\u5F55\u540D\uFF09", /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "smp-input",
        value: draft.name ?? "",
        placeholder: "\u4F8B\u5982 my-skill",
        onChange: (event) => onName(event.target.value)
      }
    )), field("\u63CF\u8FF0", /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "smp-input",
        value: draft.description ?? "",
        placeholder: "\u4E00\u53E5\u8BDD\u8BF4\u660E\u4F55\u65F6\u4F7F\u7528\u5B83",
        onChange: (event) => onDescription(event.target.value)
      }
    )), field("\u6B63\u6587\uFF08SKILL.md \u7684\u5185\u5BB9\uFF09", /* @__PURE__ */ __dshReact.createElement(
      "textarea",
      {
        className: "smp-textarea",
        rows: 8,
        value: draft.body ?? "",
        onChange: (event) => onBody(event.target.value)
      }
    ), true)), pending ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-pendingHint", key: "pending" }, "\u6B63\u5728\u4E0E\u78C1\u76D8\u540C\u6B65\u2026") : null, error !== "" ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-error", key: "err", style: { marginTop: 8 } }, error) : null)
  );
}

// lib/src/crud/skills.js
function removalTargetOf(skill = {}) {
  const name = String(skill?.name ?? "");
  const scope = typeof skill?.scope === "string" && skill.scope !== "" ? skill.scope : "global";
  return { name, scopeKey: scope === "global" ? "global" : scope };
}
function dropOptimisticSkill(optimistic = [], name) {
  const wanted = String(name ?? "");
  if (wanted === "") return optimistic;
  const next = optimistic.filter((entry) => entry.name !== wanted);
  return next.length === optimistic.length ? optimistic : next;
}
function hideSkillUntilGone(removedKeys = [], name, scopeKey2) {
  const wanted = String(name ?? "");
  if (wanted === "") return removedKeys;
  const key = `${wanted}::${scopeKey2 === void 0 || scopeKey2 === "" ? "global" : scopeKey2}`;
  if (removedKeys.includes(key)) return removedKeys;
  return [...removedKeys, key];
}

// lib/src/crud/servers.js
function rowEntryId(serverName) {
  return `mcp-${serverName}`;
}
function inflightKeyForRow(entryId) {
  return String(entryId).replace(/^include:/, "");
}
function text(value) {
  return typeof value === "string" ? value : value === void 0 || value === null ? "" : String(value);
}
function connectionDraft(source) {
  return {
    failOnStartupError: source?.failOnStartupError === true,
    reconnectInitialDelayMs: text(source?.reconnectInitialDelayMs),
    reconnectMaxDelayMs: text(source?.reconnectMaxDelayMs),
    reconnectMaxAttempts: text(source?.reconnectMaxAttempts),
    toolCallTimeoutMs: text(source?.toolCallTimeoutMs),
    // 布尔，不走 `text()`：它是开关不是输入框，`text(false)` 会变成字符串 "false"
    // 而让 `=== true` 永远不成立 —— 勾选框会静默失效。
    allowInsecureTokenEndpoint: source?.allowInsecureTokenEndpoint === true
  };
}
function connectionChanged(draft, original) {
  if (original === void 0 || original === null) return false;
  const next = connectionDraft(draft);
  const before = connectionDraft(original);
  return next.failOnStartupError !== before.failOnStartupError || next.reconnectInitialDelayMs !== before.reconnectInitialDelayMs || next.reconnectMaxDelayMs !== before.reconnectMaxDelayMs || next.reconnectMaxAttempts !== before.reconnectMaxAttempts || next.toolCallTimeoutMs !== before.toolCallTimeoutMs || next.allowInsecureTokenEndpoint !== before.allowInsecureTokenEndpoint;
}
function scopeFields(draft) {
  const scope = typeof draft.scope === "string" ? draft.scope : "";
  return { scope, scopeChanged: draft.scopeChanged === true };
}
function commonFields(draft) {
  return {
    serverName: draft.serverName,
    transport: draft.transport ?? "streamable-http",
    command: draft.command ?? "",
    args: typeof draft.args === "string" ? draft.args : "",
    env: typeof draft.env === "string" ? draft.env : "",
    url: draft.url ?? "",
    headers: typeof draft.headers === "string" ? draft.headers : "",
    ...connectionDraft(draft)
  };
}
function addServerOp(draft, entryId = rowEntryId(draft.serverName)) {
  return { op: "add", entryId, ...commonFields(draft), ...scopeFields(draft) };
}
function textChanged(draft, original, key) {
  if (original === void 0 || original === null) return false;
  return text(draft[key]) !== text(original[key] ?? original[`${key}Text`]);
}
function envChanged(draft, original) {
  return textChanged(draft, original, "env");
}
function headersChanged(draft, original) {
  return textChanged(draft, original, "headers");
}
function updateServerOp(entryId, draft, original) {
  return {
    op: "update",
    entryId,
    ...commonFields(draft),
    ...scopeFields(draft),
    connectionChanged: connectionChanged(draft, original),
    envChanged: envChanged(draft, original),
    headersChanged: headersChanged(draft, original)
  };
}
function toggleServerOp(entryId, enabled) {
  return { op: "toggle", entryId, enabled };
}
function deleteServerOp(entryId) {
  return { op: "delete", entryId };
}
function draftFromRow(row) {
  const stdio = (row.transport ?? "streamable-http") === "stdio";
  return {
    serverName: row.serverName ?? "",
    transport: row.transport ?? "streamable-http",
    url: stdio ? "" : row.url ?? row.target ?? "",
    command: row.command ?? "",
    args: typeof row.args === "string" ? row.args : "",
    env: typeof row.env === "string" ? row.env : "",
    // Headers are prefilled for the same reason the connection fields are: an
    // untouched field must round-trip, or saving an unrelated edit (say the URL)
    // would delete the authorization header the row was relying on.
    headers: stdio ? "" : headersDraft(row.headersText ?? row.headers),
    runtime: "auto",
    ...connectionDraft(row)
  };
}
function headersDraft(headers) {
  if (headers === null || headers === void 0) return "";
  if (typeof headers === "string") return headers;
  if (typeof headers !== "object" || Array.isArray(headers)) return "";
  return Object.entries(headers).map(([key, value]) => `${key}=${String(value)}`).join("\n");
}

// lib/src/crud/import.js
function takenNames({ scope, target, profileRows = [], servers = [] }) {
  if (scope === "global") return new Set(profileRows.map((row) => row.serverName));
  return new Set(
    servers.filter((server) => (server.scope ?? "global") === target).map((server) => server.serverName)
  );
}
function splitImport(found = [], taken = /* @__PURE__ */ new Set()) {
  const fresh = found.filter((server) => !taken.has(server.serverName));
  const skipped = found.filter((server) => taken.has(server.serverName));
  return { fresh, skipped };
}
function importLabel({ scope, fresh, skipped }) {
  const suffix = skipped > 0 ? `\uFF08\u8DF3\u8FC7 ${skipped} \u4E2A\uFF09` : "";
  return scope === "global" ? `\u5BFC\u5165 ${fresh} \u4E2A\u5230\u914D\u7F6E\u6587\u4EF6${suffix}` : `\u5BFC\u5165 ${fresh} \u4E2A${suffix}`;
}

// lib/src/styles/panel.css
var panel_default = "/*\r\n * Panel styles. Kept in its own file and inlined into lib/client.js by\r\n * esbuild (`loader: { \".css\": \"text\" }`), because DSH's ModuleLoader evaluates\r\n * exactly one file per client bundle.\r\n */\r\n.smp-page{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:14px;display:flex}\r\n.smp-page>*{width:100%;max-width:960px}\r\n.smp-pageHead{box-sizing:border-box;justify-content:space-between;align-items:flex-start;gap:16px;display:flex}\r\n.smp-pageTitle{margin:0;font-size:18px;font-weight:500;line-height:26px}\r\n.smp-pageIntro{color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;margin:4px 0 0;font-size:13px;line-height:20px;display:flex}\r\n.smp-toolbar{justify-content:flex-end;align-items:center;gap:8px;display:flex;flex:none}\r\n.smp-input,.smp-select,.smp-textarea{box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:0 10px;height:32px;font-size:13px}\r\n.smp-textarea{height:auto;min-height:84px;padding:8px 10px;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}\r\n.smp-input:focus-visible,.smp-select:focus-visible,.smp-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}\r\n.smp-tabs{display:flex;gap:24px;border-bottom:.5px solid var(--dsw-alias-border-l2)}\r\n.smp-tab{appearance:none;background:none;border:0;padding:0 2px 10px;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}\r\n.smp-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}\r\n.smp-filterRow{display:flex;align-items:center;gap:8px}\r\n.smp-search{flex:1 1 auto;min-width:140px;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}\r\n.smp-searchIcon{position:absolute;left:12px;display:inline-flex;pointer-events:none}\r\n.smp-searchInput{box-sizing:border-box;width:100%;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:0 12px 0 36px}\r\n.smp-searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}\r\n/* \u4F5C\u7528\u57DF\u9009\u62E9\u5668\uFF08\u8868\u5355\u5185\uFF09\uFF1A\u4E0B\u62C9 + \u81EA\u5B9A\u4E49\u8DEF\u5F84\u8F93\u5165\u5E76\u6392\uFF0C\u8DDF\u968F\u8868\u5355\u5B57\u6BB5\u5BBD\u5EA6\u3002 */\r\n.smp-scopePick{display:flex;flex-direction:column;gap:6px;min-width:0}\r\n.smp-scopePick .smp-select{width:100%}\r\n.smp-scopePick .smp-input{width:100%}\r\n.smp-group{flex-direction:column;gap:10px;display:flex;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:0}\r\n.smp-group:first-of-type{border-top:0;padding-top:0}\r\n.smp-groupTitleRow{align-items:center;gap:8px;min-height:36px;display:flex}\r\n.smp-groupToggle{color:inherit;font:inherit;text-align:left;cursor:pointer;background:none;border:0;flex:none;align-items:center;gap:8px;padding:0;display:flex}\r\n.smp-groupTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}\r\n.smp-groupSub{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex-wrap:wrap;row-gap:4px;margin:-6px 0 0 20px;font-size:12px;line-height:18px;display:flex}\r\n.smp-summaryAbove{margin:0}\r\n.smp-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .14s ease-in-out}\r\n.smp-chevron[data-open=false]{transform:rotate(-90deg)}\r\n/* Rows follow the Models settings page: one column list, head row with the\r\n   actions pinned right, and an open body that can hold arbitrarily long text. */\r\n.smp-cards{flex-direction:column;gap:14px;margin:0;padding:0;list-style:none;display:flex}\r\n.smp-card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);flex-direction:column;gap:4px;padding:12px 14px;min-width:0;display:flex}\r\n/* \u5361\u7247\u5206\u4E24\u5217\uFF1A\u5DE6\u5217\u662F\u300C\u6807\u9898\u884C + \u63CF\u8FF0\u300D\uFF0C\u53F3\u5217\u662F\u64CD\u4F5C\u533A\u3002\u6574\u884C\u5782\u76F4\u5C45\u4E2D\u5BF9\u9F50\uFF0C\r\n   \u8FD9\u6837\u5F00\u5173/\u83DC\u5355\u4E0E\u4E24\u884C\u5185\u5BB9\u5C45\u4E2D\uFF0C\u800C\u4E0D\u662F\u53EA\u8DDF\u6807\u9898\u90A3\u4E00\u884C\u5C45\u4E2D\uFF08\u90A3\u4F1A\u504F\u4E0A\uFF09\u3002\r\n   \u5C55\u5F00\u7684\u8BE6\u60C5\u5728 cardRow \u4E4B\u5916\uFF0C\u5360\u6EE1\u6574\u884C\u5BBD\u5EA6\u3002 */\r\n.smp-cardRow{align-items:center;gap:10px;min-width:0;display:flex}\r\n.smp-cardMain{flex:1 1 auto;min-width:0;flex-direction:column;gap:4px;display:flex}\r\n.smp-cardHead+.smp-cardDescription{margin-top:0}\r\n.smp-cardHead{align-items:center;gap:10px;min-width:0;display:flex}\r\n.smp-cardToggle{box-sizing:border-box;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:8px;min-width:0;padding:0;display:inline-flex}\r\n.smp-cardIdentity{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;min-width:0;overflow-wrap:anywhere}\r\n.smp-cardEnd{flex:none;align-items:center;gap:8px;display:inline-flex}\r\n.smp-cardActions{align-items:center;gap:4px;margin-left:auto;flex:none;display:inline-flex}\r\n.smp-cardActions .smp-actionsRow{margin:0;gap:4px}\r\n.smp-cardActions .smp-button{box-sizing:border-box;height:28px;padding:0 10px;font-size:12px;line-height:18px;border-radius:var(--dsw-radius-sm)}\r\n.smp-cardDescription{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}\r\n.smp-cardDetails{border-top:.5px solid var(--dsw-alias-border-l2);padding:12px 0 0}\r\n.smp-card>.smp-cardDetails:first-child{border-top:0;padding-top:0}\r\n.smp-formGrid:first-child{margin-top:0}\r\n.smp-cardDetails .smp-details{margin:0}\r\n.smp-details{grid-template-columns:76px minmax(0,1fr);gap:6px 10px;margin:8px 0 0;display:grid;font-size:12px;line-height:18px}\r\n.smp-detailsKey{color:var(--dsw-alias-label-tertiary)}\r\n/* \u503C\u662F**\u6570\u636E**\uFF0C\u952E\u624D\u662F\u8BF4\u660E\u3002\u4E24\u8005\u90FD\u7528\u7070\u65F6\u6574\u5757\u8BFB\u8D77\u6765\u662F\u4E00\u7247\u4F4E\u5BF9\u6BD4\u6587\u5B57\uFF0C\r\n   \u5206\u4E0D\u6E05\u54EA\u4E2A\u662F\u6807\u7B7E\u3001\u54EA\u4E2A\u662F\u5185\u5BB9 \u2014\u2014 \u503C\u7528\u4E3B\u8272\uFF08\u6B63\u6587\u9ED1\uFF09\uFF0C\u952E\u4FDD\u7559\u4E09\u7EA7\u7070\u3002 */\r\n.smp-detailsValue{color:var(--dsw-alias-label-primary);word-break:break-all;font-weight:400}\r\n.smp-tag{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}\r\n.smp-tag[data-tone=neutral]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}\r\n/* \u8FDE\u63A5\u72B6\u6001\u6807\u7B7E\u7684\u4E09\u6863\u8BED\u6C14\u3002\r\n   danger \u4E00\u6863\u5FC5\u987B\u771F\u7684\u663E\u773C\uFF1A\u5B83\u51FA\u73B0\u7684\u573A\u666F\u6B63\u662F\u300C\u8FD9\u4E2A MCP \u5DF2\u7ECF\u6C38\u4E45\u5931\u6548\u3001\u8981\u7528\u6237\u52A8\u624B\u300D\uFF0C\r\n   \u800C\u8FD9\u4E2A\u95EE\u9898\u4EE5\u524D\u5728\u754C\u9762\u4E0A\u5B8C\u5168\u4E0D\u53EF\u89C1\uFF08\u5DE5\u5177\u51ED\u7A7A\u6D88\u5931\uFF0C\u6CA1\u6709\u4EFB\u4F55\u8BF4\u660E\uFF09\u3002\r\n   \u4E3B\u9898\u91CC\u6CA1\u6709 error-tertiary \u80CC\u666F\uFF0C\u6240\u4EE5\u7528\u63CF\u8FB9\u800C\u4E0D\u662F\u586B\u8272\u6765\u62C9\u5F00\u5BF9\u6BD4\u3002 */\r\n.smp-tag[data-tone=ok]{background:var(--dsw-alias-state-success-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-success-primary,#067647)}\r\n.smp-tag[data-tone=warn]{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-warn-primary,#b54708)}\r\n.smp-tag[data-tone=danger]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-error-primary,#d92d20);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-error-primary,#d92d20)}\r\n/* \u8FDE\u63A5\u72B6\u6001\uFF1A\u5C0F\u5706\u70B9 + \u5C0F\u53F7\u6587\u5B57\uFF08\u7167 Chrome \u6269\u5C55\u5217\u8868\u90A3\u79CD\u5F62\u6001\uFF09\u3002\r\n   \u53D6\u4EE3\u4E86\u539F\u6765\u7684\u836F\u4E38\u6807\u7B7E\uFF1A\u836F\u4E38\u7684\u89C6\u89C9\u91CD\u91CF\u4E0E\u5361\u7247\u81EA\u5DF1\u7684\u6807\u7B7E\u4E00\u6837\u91CD\uFF0C\r\n   \u4E8E\u662F\u300C\u4E00\u5207\u6B63\u5E38\u300D\u770B\u8D77\u6765\u4E5F\u50CF\u4E2A\u8B66\u544A\uFF0C\u800C\u771F\u6B63\u7684\u8B66\u544A\u53CD\u800C\u6DF7\u8FDB\u4E86\u88C5\u9970\u91CC\u3002\r\n   \u5706\u70B9\u627F\u62C5\u989C\u8272\uFF0C\u6587\u5B57\u627F\u62C5\u542B\u4E49\uFF0C\u6743\u91CD\u8BA9\u5F00 \u2014\u2014 \u6240\u4EE5\u6587\u5B57\u53D6 10px\uFF0C\u6BD4\u6B63\u6587\u5C0F\u4E00\u6863\u3002 */\r\n.smp-status{display:inline-flex;align-items:center;gap:5px;font-size:10px;line-height:16px;white-space:nowrap}\r\n.smp-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,currentColor)}\r\n.smp-dot[data-dot=ok]{background:var(--dsw-alias-state-success-primary,#067647)}\r\n.smp-dot[data-dot=warn]{background:var(--dsw-alias-state-warn-primary,#b54708)}\r\n.smp-dot[data-dot=danger]{background:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.smp-dot[data-dot=neutral]{background:var(--dsw-alias-label-tertiary,#9aa4b2)}\r\n.smp-statusText{color:var(--dsw-alias-label-secondary)}\r\n/* \u6570\u5B57\uFF08\u5DE5\u5177\u6570 / \u5269\u4F59\u65F6\u95F4\uFF09\u9000\u5230\u7B2C\u4E09\u5C42\uFF1A\u5B83\u4EEC\u662F\u4F50\u8BC1\uFF0C\u4E0D\u662F\u72B6\u6001\u672C\u8EAB\u3002 */\r\n.smp-statusMeta{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}\r\n/* danger \u4E00\u6863\u7684\u6587\u5B57\u8981\u8DDF\u4E0A\u5706\u70B9\uFF1A\u5B83\u51FA\u73B0\u7684\u573A\u666F\u6B63\u662F\u300C\u8FD9\u4E2A MCP \u5DF2\u7ECF\u6C38\u4E45\u5931\u6548\u3001\u8981\u7528\u6237\u52A8\u624B\u300D\uFF0C\r\n   \u800C\u8FD9\u4E2A\u95EE\u9898\u4EE5\u524D\u5728\u754C\u9762\u4E0A\u5B8C\u5168\u4E0D\u53EF\u89C1\uFF08\u5DE5\u5177\u51ED\u7A7A\u6D88\u5931\uFF0C\u6CA1\u6709\u4EFB\u4F55\u8BF4\u660E\uFF09\u3002\r\n   \u9EC4\u4E00\u6863\u4E0D\u4E0A\u8272\uFF1A\u300C\u8FDE\u63A5\u4E2D\u300D\u662F\u5E38\u6001\uFF0C\u300C\u9700\u8981\u6388\u6743\u300D\u4E5F\u4E0D\u662F\u6545\u969C\uFF0C\u52A0\u91CD\u5B83\u4EEC\u53EA\u4F1A\u5236\u9020\u566A\u97F3\u3002 */\r\n.smp-status:has(.smp-dot[data-dot=danger]) .smp-statusText{color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n/* \u5C0F\u53F7\u5F00\u5173\uFF1A\u66FF\u4EE3\u300C\u542F\u7528 / \u505C\u7528\u300D\u4E24\u4E2A\u6309\u94AE\u3002\r\n   \u6309\u94AE\u53EA\u8BF4\u300C\u70B9\u4E86\u6211\u505A\u4EC0\u4E48\u300D\uFF0C\u5F00\u5173\u540C\u65F6\u8BF4\u300C\u73B0\u5728\u662F\u54EA\u4E00\u6863\u300D\u2014\u2014 \u4E00\u5217\u5361\u7247\u626B\u4E0B\u6765\u80FD\u76F4\u63A5\u770B\u51FA\r\n   \u54EA\u4E9B\u662F\u5F00\u7740\u7684\u3002\u7AD6\u76F4\u5C45\u4E2D\uFF0C\u4E0E\u5B83\u6240\u5728\u884C\u7684\u6587\u5B57\u57FA\u7EBF\u5BF9\u9F50\u3002 */\r\n.smp-switch{box-sizing:border-box;flex:none;width:26px;height:15px;border-radius:999px;border:0;padding:0;cursor:pointer;position:relative;background:var(--dsw-alias-border-l3,#cbd2d9);transition:background .12s ease}\r\n.smp-switch[data-on=true]{background:var(--dsw-alias-state-success-primary,#067647)}\r\n.smp-switch:disabled{opacity:.5;cursor:default}\r\n.smp-switchKnob{position:absolute;top:1.5px;left:1.5px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .12s ease}\r\n.smp-switch[data-on=true] .smp-switchKnob{transform:translateX(11px)}\r\n.smp-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}\r\n/* \u300C\u2026\u300D+ \u7AD6\u5411\u83DC\u5355\uFF1A\u628A \u91CD\u8FDE/\u7F16\u8F91/\u5220\u9664 \u6536\u8FDB\u4E00\u4E2A popup\u3002\r\n   \u4E09\u4E2A\u6309\u94AE\u5E76\u6392\u65F6\u64CD\u4F5C\u533A\u6BD4\u5B83\u6240\u5C5E\u7684\u540D\u5B57\u8FD8\u5BBD\uFF0C\u4E24\u5217\u7F51\u683C\u4E0B\u4F1A\u628A\u670D\u52A1\u5668\u540D\u6324\u51FA\u89C6\u91CE\u3002\r\n   \u83DC\u5355\u8BA9\u8FD9\u4E00\u884C\u4FDD\u6301\u5B89\u9759\uFF0C\u800C\u300C\u5220\u9664\u300D\u8FD9\u79CD\u5F88\u5C11\u7528\u7684\u52A8\u4F5C\u672C\u6765\u5C31\u8BE5\u591A\u4E00\u6B21\u70B9\u51FB\u3002 */\r\n.smp-more{position:relative;display:inline-flex;flex:none}\r\n.smp-moreTrigger{box-sizing:border-box;width:22px;height:22px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}\r\n.smp-moreTrigger:hover{background:var(--dsw-alias-interactive-bg-hover)}\r\n.smp-moreTrigger:disabled{opacity:.5;cursor:default}\r\n/* \u906E\u7F69\u6321\u4F4F\u9875\u9762\u5176\u4F59\u90E8\u5206\u7684\u70B9\u51FB\uFF1A\u83DC\u5355\u4E0D\u8BE5\u5728\u4E00\u6B21\u65E0\u5173\u70B9\u51FB\u540E\u8FD8\u5F00\u7740\uFF0C\r\n   \u5426\u5219\u4E0B\u4E00\u6B21\u70B9\u51FB\u4F1A\u843D\u5728\u7528\u6237\u6CA1\u6253\u7B97\u6253\u5F00\u7684\u83DC\u5355\u9879\u4E0A\u3002 */\r\n.smp-menuScrim{position:fixed;inset:0;z-index:40}\r\n/* \u5F39\u51FA\u83DC\u5355\u3002\r\n   \u9ED8\u8BA4\u8FD9\u4E00\u5957\u662F**\u515C\u5E95**\uFF1A\u91CF\u4E0D\u5230\u89E6\u53D1\u6309\u94AE\u4F4D\u7F6E\u65F6\uFF08\u79BB\u7EBF\u6E32\u67D3\u3001\u6CA1\u6709\u5E03\u5C40\uFF09\u5C31\u5411\u4E0B\u5C55\u5F00\u3002\r\n   \u771F\u5B9E\u8FD0\u884C\u65F6\u4F1A\u7531 menuAnchor.js \u7B97\u51FA\u89C6\u53E3\u5750\u6807\uFF0C\u7528\u5185\u8054\u6837\u5F0F\u6539\u6210 `position:fixed` \u2014\u2014\r\n   \u8FD9\u6837\u624D\u80FD\u65E2\u4E0D\u88AB\u9762\u677F\u6EDA\u52A8\u5BB9\u5668\u7684 overflow \u88C1\u526A\uFF0C\u53C8\u80FD\u5728\u4E0B\u65B9\u653E\u4E0D\u4E0B\u65F6\u7FFB\u8F6C\u5411\u4E0A\u3002\r\n   `min-width` \u4FDD\u8BC1\u5373\u4F7F\u53EA\u6709\u300C\u6388\u6743\u300D\u4E24\u4E2A\u5B57\u4E5F\u4E0D\u4F1A\u6324\u6210\u4E00\u6761\u3002 */\r\n.smp-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:41;min-width:104px;padding:4px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);box-shadow:0 6px 20px rgba(0,0,0,.12);box-sizing:border-box}\r\n.smp-menuItem{box-sizing:border-box;width:100%;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-sm);padding:6px 10px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}\r\n.smp-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}\r\n.smp-menuItem:disabled{opacity:.5;cursor:default}\r\n.smp-menuItem[data-variant=danger]{color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.smp-menuError{display:block;padding:4px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#d92d20);white-space:normal;max-width:220px}\r\n.smp-reconnect{display:inline-flex;align-items:center;gap:6px}\r\n.smp-reconnect .smp-error{max-width:280px;white-space:normal}\r\n/* \u5C55\u5F00\u533A\u91CC\u7684\u5DE5\u5177\u6E05\u5355\uFF1A\u6570\u636E\u6765\u81EA harness \u5DE5\u5177\u6CE8\u518C\u8868\uFF0C\u53EA\u8BFB\u5C55\u793A\u3002\r\n   \u5206\u9694\u7EBF\u4E0E\u95F4\u8DDD\u6302\u5728\u6807\u9898\u4E0A\u800C\u4E0D\u662F\u5305\u88F9\u5C42\uFF1A\u7A7A\u6E05\u5355\u4E0E\u300C\u4E0D\u53EF\u8BFB\u300D\u4E24\u79CD\u72B6\u6001\u53EA\u6E32\u67D3\u6807\u9898\uFF0C\r\n   \u6302\u5728\u5305\u88F9\u5C42\u4F1A\u8BA9\u5B83\u4EEC\u7D27\u8D34\u5B57\u6BB5\u8868\uFF0C\u770B\u8D77\u6765\u50CF\u8868\u683C\u7684\u4E00\u90E8\u5206\u3002 */\r\n.smp-tools{margin:0}\r\n.smp-toolHead{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;\r\n  margin-top:10px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:8px}\r\n.smp-toolTitle{color:var(--dsw-alias-label-tertiary)}\r\n.smp-toolCount{color:var(--dsw-alias-label-secondary)}\r\n.smp-toolCount[data-tone=muted]{color:var(--dsw-alias-label-caption)}\r\n/* \u5DE5\u5177\u8FC7\u6EE4\uFF1A\u6807\u9898\u884C\u7684\u6A21\u5F0F\u9009\u62E9\u5668\uFF0C\u4E0E\u6BCF\u884C\u7684\u52FE\u9009\u6846\u3002 */\r\n.smp-toolModes{margin-left:auto;display:inline-flex;gap:2px}\r\n.smp-toolMode{appearance:none;background:none;border:.5px solid transparent;border-radius:var(--dsw-radius-sm);padding:1px 7px;font:inherit;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);cursor:pointer}\r\n.smp-toolMode:hover{background:var(--dsw-alias-interactive-bg-hover)}\r\n.smp-toolMode[data-active=true]{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}\r\n.smp-toolPick{display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer}\r\n.smp-toolPick input{margin:0;flex:none;accent-color:var(--dsw-alias-state-business-primary,#4176e6)}\r\n/* \u5F00\u542F\u8FC7\u6EE4\u540E\uFF0C\u4E0D\u4F1A\u88AB\u6CE8\u518C\u7684\u884C\u6DE1\u5316\u2014\u2014\u4E00\u773C\u770B\u51FA\u300C\u8FD9\u4E2A\u5DE5\u5177\u6A21\u578B\u770B\u4E0D\u5230\u300D\u3002\r\n   \u5224\u636E\u662F\u300C\u662F\u5426\u4FDD\u7559\u300D\u800C\u975E\u300C\u662F\u5426\u52FE\u9009\u300D\uFF1Adeny \u6A21\u5F0F\u4E0B\u4E24\u8005\u6070\u597D\u76F8\u53CD\u3002 */\r\n.smp-tool[data-kept=false] .smp-toolName{color:var(--dsw-alias-label-tertiary);font-weight:400}\r\n.smp-tool[data-kept=false] .smp-toolDesc{opacity:.7}\r\n.smp-toolList{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}\r\n.smp-tool{display:flex;flex-direction:column;gap:1px;padding:3px 0;min-width:0}\r\n/* \u5DE5\u5177\u540D\u662F\u8FD9\u4E00\u884C\u7684\u300C\u6807\u9898\u300D\uFF0C\u63CF\u8FF0\u662F\u300C\u526F\u6807\u9898\u300D\uFF0C\u6240\u4EE5\u4E24\u8005\u8981\u6709\u5C42\u7EA7\u5DEE\uFF1A\r\n   \u540D\u5B57 13px + 500 \u5B57\u91CD + \u4E3B\u8272\uFF0C\u63CF\u8FF0 11px + \u4E09\u7EA7\u8272\u3002\r\n   \u884C\u9AD8\u8D70\u9762\u677F\u5DF2\u6709\u7684\u9636\u68AF\uFF0813px\u219220px\uFF0C\u4E0E .smp-empty \u4E00\u81F4\uFF1B11px\u219216px\uFF09\u3002 */\r\n.smp-toolName{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);word-break:break-all}\r\n/* \u63CF\u8FF0\u5B8C\u6574\u5C55\u793A\uFF0C\u53EA\u5728\u6781\u7AEF\u957F\u7684\u5C11\u6570\u60C5\u51B5\u4E0B\u6298\u884C\u5C01\u9876\u3002\r\n   \u5B9E\u6D4B 35 \u4E2A\u771F\u5B9E MCP \u5DE5\u5177\uFF1A\u4E2D\u4F4D 74 \u5B57\u7B26\u3001p75 151\u3001p90 318\u3001\u6700\u957F 2006\u2014\u2014\r\n   \u7EDD\u5927\u591A\u6570\u53EA\u5360\u4E00\u4E24\u884C\uFF0C\u6240\u4EE5\u4E0D\u6309\u5B57\u7B26\u6570\u622A\u65AD\uFF08\u90A3\u4F1A\u767D\u767D\u780D\u6389\u5927\u591A\u6570\uFF09\uFF0C\r\n   \u53EA\u7ED9\u957F\u5C3E\u4E00\u4E2A\u4E0A\u9650\uFF0C\u5B8C\u6574\u6587\u672C\u4ECD\u901A\u8FC7 title \u5C5E\u6027\u53EF\u67E5\u3002 */\r\n.smp-toolDesc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;line-clamp:4;overflow:hidden}\r\n.smp-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px;list-style:none}\r\n.smp-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;list-style:none}\r\n/* \u73AF\u5883\u53D8\u91CF\u5B57\u6BB5\uFF1A\u6587\u672C\u6846 + \u81EA\u52A8\u6CE8\u5165\u8BF4\u660E\u3002\u8BF4\u660E\u91CC\u7684 code \u7528\u7B49\u5BBD\u5B57\u4F53\u70B9\u51FA\u5173\u952E\u540D\u3002 */\r\n.smp-envField{display:flex;flex-direction:column;gap:6px;min-width:0}\r\n.smp-envField code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;background:var(--dsw-alias-bg-module-platform);border-radius:var(--dsw-radius-xs,4px);padding:0 4px}\r\n.smp-formGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}\r\n.smp-field{display:flex;flex-direction:column;gap:6px;min-width:0}\r\n.smp-field[data-wide=true]{grid-column:1 / -1}\r\n/* \u6280\u80FD\u5BF9\u8BDD\u6846\u91CC\u300C\u5C06\u5199\u5165 <\u8DEF\u5F84>\u300D\u90A3\u4E00\u884C\uFF1A\u5B83\u4E0D\u5C5E\u4E8E\u4EFB\u4F55\u5B57\u6BB5\uFF0C\u4F46\u8981\u8DE8\u6EE1\u4E24\u5217\u3002 */\r\n.smp-skillPath{grid-column:1 / -1}\r\n/* MCP\u300C\u9700\u8981\u6388\u6743\u300D\u5757\uFF1A\u4E00\u679A\u4E3B\u64CD\u4F5C + \u53EF\u9009\u7684\u6B21\u8981\u64CD\u4F5C\uFF0C\u4E0B\u9762\u662F\u6388\u6743\u94FE\u63A5\u3002 */\r\n.smp-oauthRow{display:flex;align-items:center;gap:8px;margin-top:6px}\r\n/* \u6388\u6743\u94FE\u63A5\u662F\u53EA\u8BFB\u8F93\u5165\u6846\u800C\u4E0D\u662F\u7EAF\u6587\u672C\uFF1A\u94FE\u63A5\u5F88\u957F\uFF0C\u7EAF\u6587\u672C\u9009\u4E2D\u4F1A\u628A\u76F8\u90BB\u6587\u5B57\u4E00\u8D77\u5E26\u4E0A\uFF0C\r\n   \u800C\u5B83\u5FC5\u987B\u80FD\u88AB\u5B8C\u6574\u590D\u5236\uFF08\u7528\u6237\u8981\u7C98\u5230\u6D4F\u89C8\u5668\u91CC\uFF09\u3002 */\r\n.smp-oauthUrl{box-sizing:border-box;flex:1 1 auto;min-width:0;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-l1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\r\n.smp-oauthLinkRow{display:flex;align-items:center;gap:8px;margin-top:2px}\r\n/* \u5931\u8D25\u6587\u6848\u7528\u9519\u8BEF\u8272\uFF0C\u4F46**\u4E0D\u52A0\u7C97\u3001\u4E0D\u653E\u5927**\uFF1A\u5B83\u4E0D\u662F\u6545\u969C\u8B66\u62A5\uFF0C\u53EA\u662F\u8FD9\u6B21\u64CD\u4F5C\u6CA1\u6210\u529F\u3002 */\r\n.smp-oauthError{color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.smp-label{font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}\r\n.smp-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:32px;padding:0 14px;border:.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;flex:none}\r\n.smp-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}\r\n.smp-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}\r\n.smp-button[data-variant=outline]{border-color:var(--dsw-alias-border-l3)}\r\n.smp-button[data-variant=danger]{color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.smp-cardActions .smp-button[data-variant=danger]{border-color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.smp-spinner{display:inline-block;width:12px;height:12px;box-sizing:border-box;border:1.5px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:smp-spin .72s linear infinite;flex:none}\r\n@keyframes smp-spin{to{transform:rotate(360deg)}}\r\n.smp-pending{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}\r\n.smp-segment{align-self:flex-start;display:inline-flex;align-items:center;gap:2px;padding:2px;background:var(--dsw-alias-bg-module-platform);border-radius:var(--dsw-radius-md);width:fit-content}\r\n.smp-segment>button{box-sizing:border-box;height:28px;padding:0 12px;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:0 0;border:0;border-radius:var(--dsw-radius-sm);cursor:pointer}\r\n.smp-segment>button[data-active=true]{background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);font-weight:500}\r\n.smp-cardDetails .smp-input{box-sizing:border-box;width:100%;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:0 10px}\r\n.smp-cardDetails .smp-select,.smp-select{box-sizing:border-box;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);appearance:none;-webkit-appearance:none;padding:0 30px 0 10px;background-image:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6.5 8 10.5 12 6.5' stroke='%238b8f99' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 10px center;background-size:14px}\r\n.smp-cardDetails .smp-input[readonly]{color:var(--dsw-alias-label-secondary)}\r\n.smp-button[data-variant=primary]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}\r\n.smp-button[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}\r\n.smp-button:disabled{opacity:.4;cursor:not-allowed}\r\n.smp-actionsRow{display:flex;align-items:center;gap:8px;margin-top:10px}\r\n.smp-error{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-size:12px;line-height:18px}\r\n\r\n/* Card description (the subtitle under a title): always exactly two lines at\r\n   most, with an ellipsis \u2014 long skill descriptions used to push the layout. */\r\n.smp-cardDescription {\r\n  display: -webkit-box;\r\n  -webkit-line-clamp: 2;\r\n  -webkit-box-orient: vertical;\r\n  overflow: hidden;\r\n  overflow-wrap: anywhere;\r\n  text-overflow: ellipsis;\r\n}\r\n\r\n/* Visible progress while a save is in flight (the button also reads \u4FDD\u5B58\u4E2D\u2026). */\r\n.smp-pendingHint {\r\n  margin-top: 8px;\r\n  font-size: 12px;\r\n  opacity: 0.75;\r\n}\r\n\r\n/* The skill dialog body already lands on the description's box (274\u21921166) once\r\n   the dialog is widened, so it needs no side padding \u2014 adding one only squeezed\r\n   the form fields 48px narrower than the header text. */\r\n.smp-skillDialogBody {\r\n  width: auto;\r\n  max-width: 100%;\r\n  min-width: 0;\r\n  padding: 6px 0 10px;\r\n  box-sizing: border-box;\r\n}\r\n\r\n/* Skill preview.\r\n   The official modal must be widened itself \u2014 forcing a min-width on the inner\r\n   wrapper just clipped the text against the modal's own overflow. `:has()` lets\r\n   us reach the dialog that contains the preview. */\r\ndiv:has(> .smp-previewWrap),\r\ndiv[role='dialog']:has(.smp-previewWrap),\r\n[class*='modal']:has(.smp-previewWrap),\r\n[class*='Modal']:has(.smp-previewWrap),\r\n/* Add/edit skill dialog: same width as the preview. */\r\ndiv[role='dialog']:has(.smp-skillDialogBody),\r\n[class*='modal']:has(.smp-skillDialogBody),\r\n[class*='Modal']:has(.smp-skillDialogBody) {\r\n  width: min(940px, 92vw) !important;\r\n  max-width: 92vw !important;\r\n}\r\n\r\n.smp-previewWrap {\r\n  /* Measured geometry inside the official modal (dialog 250\u21921190):\r\n       description slot  274 \u2192 1166  (892 wide, padded 24 on both sides)\r\n       children slot     274 \u2192 1214  (940 wide, no right gutter)\r\n     The preview lives in the children slot, so it only needs the difference\r\n     trimmed on the right: 940 \u2212 892 = 48px. No left padding. */\r\n  width: auto;\r\n  max-width: 100%;\r\n  min-width: 0;\r\n  padding: 6px 48px 10px 0;\r\n  box-sizing: border-box;\r\n}\r\n\r\n/* Description + file path: the path is long, so it gets its own wrapped line. */\r\n.smp-previewMeta { display: block; }\r\n.smp-previewDesc { margin-bottom: 6px; overflow-wrap: anywhere; }\r\n.smp-previewPath {\r\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\r\n  font-size: 12px;\r\n  opacity: 0.75;\r\n  overflow-wrap: anywhere;\r\n  word-break: break-all;\r\n}\r\n\r\n.smp-preview {\r\n  margin: 0;\r\n  padding: 14px 16px;\r\n  background: var(--dsh-bg-secondary, rgba(127, 127, 127, 0.07));\r\n  border-radius: 10px;\r\n  /* The cap must leave room for the modal's own chrome (title + description +\r\n     footer) or a long body pushes the dialog past the window. Measured chrome is\r\n     ~180-210px, so subtract it from the viewport rather than using a bare vh. */\r\n  min-height: min(46vh, calc(100vh - 260px));\r\n  max-height: min(70vh, calc(100vh - 210px));\r\n  width: auto;\r\n  max-width: 100%;\r\n  box-sizing: border-box;\r\n  /* Wrap at the padding edge; vertical scroll only, never silently clipped. */\r\n  overflow-y: auto;\r\n  white-space: pre-wrap;\r\n  overflow-wrap: anywhere;\r\n  word-break: break-word;\r\n  min-width: 0;\r\n  /* Equal gutters on both sides for every wrapped line. */\r\n  text-align: left;\r\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\r\n  font-size: 13px;\r\n  line-height: 1.65;\r\n  color: var(--dsh-text-secondary, inherit);\r\n}\r\n\r\n/* Skill source tag sits next to the name: give it the same breathing room the\r\n   MCP rows' \"\u914D\u7F6E\u6587\u4EF6\" tag has in smp-cardEnd. */\r\n.smp-cardIdentity .smp-tag {\r\n  margin-left: 6px;\r\n}\r\n\r\n/* Horizontal rule between two independent settings in the form grid.\r\n\r\n   The grid is two columns, so the rule has to span both. Zero height plus the grid's own\r\n   `gap` gives the separation \u2014 no margins, which would add to the gap and make the two\r\n   sides look like different sections rather than siblings. */\r\n.smp-divider {\r\n  grid-column: 1 / -1;\r\n  /* `1px` rather than the `.5px` used for card borders: a hairline that disappears on a\r\n     non-retina display is worse than a slightly heavier rule here, and this one is the only\r\n     thing separating two settings that would otherwise read as one group. */\r\n  border-top: 1px solid var(--dsw-alias-border-l2);\r\n  height: 0;\r\n}\r\n\r\n/* Boolean setting inside a form field: a switch plus its explanatory text.\r\n\r\n   The old checkbox row had a **fixed `height: 32px`**, which was fine for a one-line label and\r\n   wrong the moment the text wrapped: two lines of 13px/18px need 36px, so the second line was\r\n   squeezed against the first and the row looked clipped. Almost every one of these labels is a\r\n   full sentence, so wrapping is the normal case, not the exception \u2014 the fixed height was the\r\n   bug, not the text.\r\n\r\n   So: no fixed height (let it grow), `flex-start` so the switch lines up with the **first** line\r\n   of text instead of floating in the middle of a two-line block, and a line-height that matches\r\n   the switch's own height so the first line and the thumb share a baseline. */\r\n.smp-switchRow {\r\n  display: flex;\r\n  /* \u6587\u5B57\u5728\u5DE6\u3001\u5F00\u5173\u56FA\u5B9A\u8D34\u53F3\uFF1A\u6574\u5F20\u8868\u5355\u7684\u5E03\u5C14\u8BBE\u7F6E\u90FD\u8BFB\u6210\u300C\u8FD9\u4E00\u9879\u53EB\u4EC0\u4E48 \u2192 \u5B83\u662F\u54EA\u4E00\u6863\u300D\uFF0C\r\n     \u5F00\u5173\u4F4D\u7F6E\u4E0D\u518D\u968F\u6587\u5B57\u957F\u5EA6\u5DE6\u53F3\u6D6E\u52A8\u3002 */\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 12px;\r\n  padding: 2px 0;\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n/* The control slot.\r\n\r\n   A wrapper rather than a rule on the control itself, because the control is either the Host's\r\n   `primitives.Switch` **or** our own `.smp-switch` fallback button \u2014 different elements with\r\n   different class names. Targeting a slot keeps `flex: none` applying to both, instead of\r\n   silently working only on whichever one the current Host happens to render. */\r\n.smp-switchRow > .smp-switchSlot {\r\n  flex: none;\r\n  display: flex;\r\n  align-items: center;\r\n  /* `min-content` keeps the pill from being squeezed when the text column grows; the row's\r\n     `space-between` then does the positioning, so no magic left/right value is needed. */\r\n  min-width: min-content;\r\n}\r\n\r\n/* Wrapping text column. `min-width: 0` is what actually allows it to wrap inside a flex row \u2014\r\n   without it the column takes its max-content width and overflows the dialog. */\r\n.smp-switchRowText {\r\n  display: flex;\r\n  flex-direction: column;\r\n  flex: 1 1 auto;\r\n  gap: 3px;\r\n  min-width: 0;\r\n  font-size: 13px;\r\n  line-height: 20px;\r\n}\r\n\r\n/* The consequence sentence. Deliberately a separate line from the title: a warning that is\r\n   appended to the label reads as part of the name and gets skimmed past. */\r\n.smp-switchRowHint {\r\n  font-size: 12px;\r\n  line-height: 17px;\r\n  color: var(--dsw-alias-label-secondary);\r\n}\r\n";

// lib/src/client.js
window.__ModuleLoader__.load({
  id: "@j62268781-alt/dsh-skills-mcp-manager",
  factory(require2) {
    const React = require2("react");
    globalThis.__dshReact = React;
    const primitives = (() => {
      try {
        return require2("@deepseek-ai/dsh-client-ui-primitives");
      } catch {
        return null;
      }
    })();
    const h = React.createElement;
    const switchControl = (checked, onChange, label, disabled = false) => primitives?.Switch !== void 0 ? /* @__PURE__ */ __dshReact.createElement(primitives.Switch, { key: "switch", checked, disabled, label, onChange }) : /* @__PURE__ */ __dshReact.createElement(
      "button",
      {
        className: "smp-switch",
        key: "switch",
        type: "button",
        role: "switch",
        "aria-checked": checked,
        "aria-label": label,
        "data-on": checked ? "true" : "false",
        disabled,
        onClick: () => onChange(!checked)
      },
      /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchKnob", key: "k" })
    );
    const { useState, useEffect, useMemo, useRef } = React;
    const CSS = panel_default;
    function Panel(props) {
      const form = props.form;
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const store = form?.store ?? form;
        const subscribe = typeof store?.subscribe === "function" ? store.subscribe.bind(store) : null;
        if (subscribe === null) return void 0;
        const unsubscribe = subscribe(() => setTick((n) => n + 1));
        return typeof unsubscribe === "function" ? unsubscribe : void 0;
      }, [form]);
      const [tab, setTab] = useState("mcp");
      const [query, setQuery] = useState("");
      const [expanded, setExpanded] = useState("");
      const [menuFor, setMenuFor] = useState("");
      const [menuAnchor, setMenuAnchor] = useState(null);
      const [editing, setEditing] = useState(null);
      const [draft, setDraft] = useState({});
      const [scopeDraft, setScopeDraft] = useState({ value: "", custom: false });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [confirming, setConfirming] = useState("");
      const [deleteDialog, setDeleteDialog] = useState(null);
      const [reconnectState, setReconnectState] = useState({});
      const [deleteNonce, setDeleteNonce] = useState("");
      const [deletePending, setDeletePending] = useState(false);
      const [deleteError, setDeleteError] = useState("");
      const [optimistic, setOptimistic] = useState([]);
      const [removedKeys, setRemovedKeys] = useState([]);
      const opCtxRef = useRef(null);
      const nonceSeqRef = useRef(0);
      const nextNonce = () => `${Date.now().toString(36)}-${nonceSeqRef.current += 1}`;
      const [skillPendingPath, setSkillPendingPath] = useState("");
      const [skillPreview, setSkillPreview] = useState(null);
      const [skillDialog, setSkillDialog] = useState(null);
      const [skillDraft, setSkillDraft] = useState({ name: "", description: "", body: "" });
      const [skillError, setSkillError] = useState("");
      const [skillNonce, setSkillNonce] = useState("");
      const skillSentAtRef = useRef(0);
      const resetSkillPending = () => {
        setSkillNonce("");
        setEditBodyPending(false);
        setEditBodyNonce("");
      };
      const finishSkillDelete = (delResult) => {
        const target = deleteTargetRef.current;
        setSkillPendingPath("");
        if (delResult?.ok === true) {
          setDeleteDialog(null);
          setDeleteError("");
          if (target !== null) {
            setOptimistic((list) => dropOptimisticSkill(list, target.name));
            setRemovedKeys((list) => hideSkillUntilGone(list, target.name, target.scopeKey));
          }
        } else {
          setSkillError(String(delResult?.reason ?? "\u5220\u9664\u5931\u8D25"));
          if (target !== null) setOptimistic((list) => dropOptimisticSkill(list, target.name));
        }
        deleteTargetRef.current = null;
        setDeletePending(false);
        setDeleteNonce("");
      };
      const applyOptimisticSkillWrite = (ctx) => {
        if (ctx === null) return;
        const dirs = runtime.skillDirs ?? {};
        const isProject = ctx.scope === "project" && String(ctx.project ?? "") !== "";
        const base = isProject ? `${String(ctx.project).replace(/\/+$/, "")}/${ctx.id === "dsh" ? ".dsh" : ".agents"}/skills` : String(ctx.id === "dsh" ? dirs.userDsh ?? "" : dirs.userAgents ?? "");
        if (ctx.kind === "create" && ctx.name !== "") {
          setOptimistic((list) => [...list.filter((e) => !(e.name === ctx.name && e.scope === (isProject ? ctx.project : "global"))), {
            name: ctx.name,
            description: ctx.description,
            source: `${isProject ? "project" : "user"}-${ctx.id === "dsh" ? "dsh" : "agents"}`,
            scope: isProject ? ctx.project : "global",
            path: base !== "" ? `${base}/${ctx.name}/SKILL.md` : "",
            optimistic: true
          }]);
        } else {
          const gone = ctx.kind === "delete" ? ctx.name : ctx.prevName;
          setOptimistic((list) => list.filter((e) => e.name !== gone));
          if (ctx.kind === "delete") {
            const scopeKey2 = ctx.scope === "project" && String(ctx.project ?? "") !== "" ? ctx.project : "global";
            setRemovedKeys((list) => [.../* @__PURE__ */ new Set([...list, `${gone}::${scopeKey2}`])]);
          }
        }
      };
      const deleteTargetRef = useRef(null);
      const [previewBody, setPreviewBody] = useState("");
      const [previewPending, setPreviewPending] = useState(false);
      const [previewNonce, setPreviewNonce] = useState("");
      const [editBodyNonce, setEditBodyNonce] = useState("");
      const [editBodyPending, setEditBodyPending] = useState(false);
      useEffect(() => {
        if (skillPendingPath === "") return void 0;
        const timer = setTimeout(() => {
          setSkillPendingPath("");
          setDeletePending(false);
          setSkillError("\u5220\u9664\u6CA1\u6709\u56DE\u6267\uFF08\u5E94\u7528\u53EF\u80FD\u6B63\u5728\u91CD\u8F7D\uFF09\uFF0C\u8BF7\u5237\u65B0\u540E\u518D\u786E\u8BA4\u4E00\u6B21");
        }, 15e3);
        return () => clearTimeout(timer);
      }, [skillPendingPath]);
      useEffect(() => {
        if (!editBodyPending || editBodyNonce === "") return void 0;
        const timer = setTimeout(() => {
          setEditBodyPending(false);
          setEditBodyNonce("");
          setSkillError("\u8BFB\u53D6\u6B63\u6587\u6CA1\u6709\u56DE\u6267\uFF08\u5E94\u7528\u53EF\u80FD\u6B63\u5728\u91CD\u8F7D\uFF09\uFF0C\u8BF7\u5173\u6389\u91CD\u5F00\u4E00\u6B21");
        }, 15e3);
        return () => clearTimeout(timer);
      }, [editBodyPending, editBodyNonce]);
      const [inflight, setInflight] = useState({});
      useEffect(() => {
        if (menuFor === "") return void 0;
        if (typeof document === "undefined") return void 0;
        const onKey = (event) => {
          if (event.key === "Escape") setMenuFor("");
        };
        document.addEventListener("keydown", onKey);
        const onReflow = () => setMenuFor("");
        document.addEventListener("scroll", onReflow, true);
        globalThis.window?.addEventListener?.("resize", onReflow);
        return () => {
          document.removeEventListener("keydown", onKey);
          document.removeEventListener("scroll", onReflow, true);
          globalThis.window?.removeEventListener?.("resize", onReflow);
        };
      }, [menuFor]);
      const [customProject, setCustomProject] = useState(false);
      const [importOpen, setImportOpen] = useState(false);
      const [importSource, setImportSource] = useState("claude");
      const [importScope, setImportScope] = useState("global");
      const [importProject, setImportProject] = useState("");
      const [importCustomProject, setImportCustomProject] = useState(false);
      const [importScan, setImportScan] = useState(null);
      const refresh = () => setTick((n) => n + 1);
      useEffect(() => {
        const timer = setInterval(refresh, 700);
        return () => clearInterval(timer);
      }, []);
      useEffect(() => {
        const timer = setInterval(refresh, 1500);
        const unsubscribe = form?.subscribe?.(refresh);
        return () => {
          clearInterval(timer);
          if (typeof unsubscribe === "function") unsubscribe();
        };
      }, [form]);
      const [inventoryRows, setInventoryRows] = useState([]);
      useEffect(() => {
        let alive = true;
        const load = () => {
          try {
            const list = props.inventory?.list;
            if (typeof list !== "function") return;
            list().then((payload) => {
              if (!alive) return;
              const entries = payload?.value?.entries ?? payload?.entries ?? [];
              setInventoryRows((Array.isArray(entries) ? entries : []).map((row) => ({
                entryId: String(row?.entryId ?? row?.id ?? "?"),
                moduleName: String(row?.moduleName ?? row?.name ?? "?"),
                enabled: row?.enabled !== false,
                fiberPhase: String(row?.fiberPhase ?? "")
              })));
            }).catch(() => {
            });
          } catch {
          }
        };
        load();
        const timer = setInterval(load, 1e4);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [props.inventory]);
      const [runtime, setRuntime] = useState({
        serverTools: [],
        serverStatus: [],
        serverToolsError: { reason: "loading", detail: "" },
        /** Host 现算的完整读模型；任何一项缺失都按空值处理（旧 Host）。 */
        servers: [],
        skills: [],
        skillDirs: {},
        workspaces: [],
        currentWorkspace: "",
        filter: {},
        probe: {},
        oauth: { servers: {} },
        discovery: {}
      });
      const [refreshPing, setRefreshPing] = useState(0);
      const bumpRefresh = () => setRefreshPing((n) => n + 1);
      useEffect(() => {
        if (typeof BroadcastChannel === "undefined") return void 0;
        let channel;
        try {
          channel = new BroadcastChannel(AUTH_CHANNEL);
        } catch {
          return void 0;
        }
        const onMessage = (event) => {
          if (event?.data === AUTH_DONE) bumpRefresh();
        };
        channel.addEventListener("message", onMessage);
        return () => {
          channel.removeEventListener("message", onMessage);
          channel.close();
        };
      }, []);
      useEffect(() => {
        let alive = true;
        let pending = false;
        let controller;
        const load = async () => {
          if (pending || typeof document !== "undefined" && document.visibilityState === "hidden") return;
          pending = true;
          controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1e4);
          try {
            const response = await fetch(`/${NAME}/runtime`, {
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (!Array.isArray(payload?.serverTools) || !Array.isArray(payload?.serverStatus) || typeof payload?.serverToolsError?.reason !== "string") throw new Error("\u54CD\u5E94\u683C\u5F0F\u65E0\u6548");
            if (alive) setRuntime(payload);
          } catch (error2) {
            if (alive) setRuntime((current) => ({
              ...current,
              serverTools: [],
              serverStatus: [],
              serverToolsError: { reason: "runtime-unavailable", detail: String(error2?.message ?? error2) }
            }));
          } finally {
            clearTimeout(timeout);
            pending = false;
          }
        };
        load();
        const timer = setInterval(load, 5e3);
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", load);
        return () => {
          alive = false;
          controller?.abort();
          clearInterval(timer);
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", load);
        };
      }, [tab, expanded, refreshPing]);
      useEffect(() => {
        if (removedKeys.length === 0) return;
        const now = new Set((runtime.skills ?? []).map((entry) => `${entry.name}::${entry.scope ?? "global"}`));
        const keep = removedKeys.filter((key) => now.has(key));
        if (keep.length !== removedKeys.length) setRemovedKeys(keep);
      }, [runtime.skills, removedKeys]);
      const serverTools = runtime.serverTools;
      const toolFilters = useMemo(() => {
        const raw = snapshotOf(form)?.toolFilters;
        return raw !== null && typeof raw === "object" ? raw : {};
      }, [form, tick]);
      const filterState = runtime.filter ?? {};
      const serverToolsError = runtime.serverToolsError;
      const serverStatus = runtime.serverStatus;
      const oauthState = runtime.oauth ?? {};
      const oauthServers = runtime.oauth?.servers ?? {};
      const [oauthResult, setOauthResult] = useState({});
      const [oauthPending, setOauthPending] = useState("");
      const [copiedUrlFor, setCopiedUrlFor] = useState("");
      const oauthServerState = (serverName) => {
        const entry = oauthServers[serverName];
        return entry !== null && typeof entry === "object" ? entry : {};
      };
      const authorizeUrlFor = (serverName) => {
        const local = String(oauthResult[serverName]?.authorizeUrl ?? "");
        if (local !== "") return local;
        return String(oauthServerState(serverName).authorizeUrl ?? "");
      };
      const oauthFailureFor = (serverName) => {
        const result = oauthResult[serverName];
        if (result === void 0 || result === null) return "";
        if (result.ok === true) return "";
        const reason = String(result.reason ?? "");
        const detail = String(result.detail ?? "");
        if (detail !== "" && detail !== reason) return `${reason === "" ? "\u6388\u6743\u5931\u8D25" : reason}\uFF1A${detail}`;
        return reason === "" ? "\u6388\u6743\u5931\u8D25" : reason;
      };
      const startOAuth = async (serverName) => {
        if (oauthPending !== "") return;
        setOauthPending(serverName);
        setCopiedUrlFor("");
        try {
          const result = await sendOAuth({ action: "authorize", serverName });
          setOauthResult((previous) => ({ ...previous, [serverName]: result }));
        } finally {
          setOauthPending("");
        }
      };
      const revokeOAuth = async (serverName) => {
        if (oauthPending !== "") return;
        setOauthPending(serverName);
        try {
          const result = await sendOAuth({ action: "logout", serverName });
          setOauthResult((previous) => ({ ...previous, [serverName]: result }));
        } finally {
          setOauthPending("");
        }
      };
      const copyAuthorizeUrl = (serverName) => {
        const url = authorizeUrlFor(serverName);
        if (url === "") return;
        try {
          void navigator.clipboard?.writeText?.(url);
          setCopiedUrlFor(serverName);
        } catch {
          setCopiedUrlFor("");
        }
      };
      const profileRows = useMemo(() => {
        const runtimeRows = Array.isArray(runtime.servers) ? runtime.servers : [];
        if (runtimeRows.length > 0) return runtimeRows;
        return inventoryRows.filter((row) => row.moduleName === "@deepseek-ai/dsh-mcp-client").map((row) => ({
          entryId: row.entryId,
          serverName: row.entryId.replace(/^include:/, "").replace(/^mcp-/, ""),
          transport: "",
          target: "",
          enabled: row.enabled,
          phase: row.fiberPhase
        }));
      }, [runtime.servers, inventoryRows]);
      const debugOn = typeof location !== "undefined" && /(?:^|[?&])smp=debug/.test(location.search);
      const debugMcp = inventoryRows.filter((row) => /mcp/i.test(row.entryId) || /mcp/i.test(row.moduleName));
      const rowOpsReady = true;
      const matches = (row) => matchesName(row.serverName ?? row.name, query);
      const isGlobal = (row) => (row.scope ?? "global") === "global";
      const skillDirs = runtime.skillDirs ?? {};
      const discoveredFromDoc = runtime.skills ?? [];
      const docKeys = new Set(discoveredFromDoc.map((entry) => `${entry.name}::${entry.scope}`));
      const removedSet = new Set(removedKeys);
      const discovered = [
        ...discoveredFromDoc.filter((entry) => !removedSet.has(`${entry.name}::${entry.scope}`)),
        ...optimistic.filter((entry) => !docKeys.has(`${entry.name}::${entry.scope}`))
      ];
      const rootIdOfSource = (source) => String(source).endsWith("-agents") ? "agents" : "dsh";
      const discoveredOnly = discovered.filter((entry) => matchesName(entry.name, query));
      const knownProjects = new Map((runtime.workspaces ?? []).filter((workspace) => typeof workspace?.path === "string" && workspace.path !== "").map((workspace) => [workspace.path, typeof workspace.title === "string" && workspace.title !== "" ? workspace.title : workspace.path]));
      const projectLabel = (path) => {
        if (typeof path !== "string" || path === "") return "";
        const known = knownProjects.get(path);
        if (known !== void 0) return known;
        return path;
      };
      const scopeTagLabel = (path) => {
        if (typeof path !== "string" || path === "" || path === "global") return "\u5168\u5C40";
        const known = knownProjects.get(path);
        if (known !== void 0) return known;
        const parts = path.replace(/\/+$/, "").split("/");
        return parts[parts.length - 1] || "";
      };
      const skillRootLabel = (scope, id) => {
        const useAgents = id === "agents";
        const leaf = useAgents ? ".agents/skills" : ".dsh/skills";
        if (typeof scope !== "string" || scope === "" || scope === "global") {
          const dirs = skillDirs;
          if (useAgents) return dirs.userAgents || "~/.agents/skills";
          return dirs.userDsh || "~/.dsh/skills";
        }
        return `${scope.replace(/\/+$/, "")}/${leaf}`;
      };
      const defaultWorkspace = () => {
        const current = runtime.currentWorkspace;
        if (typeof current === "string" && current !== "") return current;
        const configured = profileRows.map((row) => row.scope).find((scope) => typeof scope === "string" && scope !== "" && scope !== "global");
        return configured ?? "";
      };
      useEffect(() => {
        setInflight((current) => settleInflight(current, { profileRows }));
      }, [tick, profileRows, inflight]);
      const pendingOps = [];
      const pendingOf = (entryId) => pendingOps.find((op) => String(op?.entryId ?? "").replace(/^include:/, "") === String(entryId).replace(/^include:/, "")) ?? null;
      const projectChoices = useMemo(() => {
        const map = /* @__PURE__ */ new Map();
        for (const workspace of runtime.workspaces ?? []) {
          const path = typeof workspace?.path === "string" ? workspace.path : "";
          if (path !== "") map.set(path, typeof workspace.title === "string" && workspace.title !== "" ? workspace.title : path);
        }
        for (const row of profileRows) {
          const scope = row?.scope;
          if (typeof scope === "string" && scope !== "" && scope !== "global" && !map.has(scope)) map.set(scope, scope);
        }
        return [...map.entries()];
      }, [profileRows, runtime.workspaces, form, tick]);
      const workspacePaths = useMemo(() => (runtime.workspaces ?? []).map((workspace) => typeof workspace?.path === "string" ? workspace.path : "").filter((path) => path !== ""), [runtime.workspaces]);
      async function write(field_, value) {
        setBusy(true);
        setError("");
        try {
          if (typeof form?.set === "function") await form.set(field_, value);
          else if (props.mutate) await props.mutate(NAME, [{ op: "set", path: [field_], value }]);
          refresh();
          bumpRefresh();
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        } finally {
          setBusy(false);
        }
      }
      const bareRowId = (entryId) => String(entryId).replace(/^include:/, "").replace(/^[a-z-]+:/i, "");
      const sendRowOp = async (op) => {
        const payload = { ...op, entryId: bareRowId(op.entryId) };
        if (typeof fetch !== "function") return { ok: false, reason: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch" };
        try {
          const response = await fetch(`/${NAME}/rows`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (response.status === 404 || response.status === 405) {
            return { ok: false, reason: "\u8FD9\u4E2A Host \u6CA1\u6709\u884C\u547D\u4EE4\u8DEF\u7531\uFF08Host \u4FA7\u6539\u52A8\u9700\u8981\u91CD\u542F\u4E00\u6B21 DSH\uFF09" };
          }
          if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: "\u8BF7\u6C42\u672A\u88AB\u4FE1\u4EFB\uFF08\u8BF7\u4ECE DSH \u9762\u677F\u91CC\u64CD\u4F5C\uFF09" };
          }
          if (!response.ok) {
            let reason = `HTTP ${String(response.status)}`;
            try {
              const body = await response.json();
              if (typeof body?.reason === "string" && body.reason !== "") reason = body.reason;
            } catch {
            }
            return { ok: false, reason };
          }
          const result = await response.json();
          if (result?.ok === true) {
            return { ok: true, reason: "", servers: Array.isArray(result.servers) ? result.servers : null };
          }
          return { ok: false, reason: String(result?.reason ?? "\u5199\u5165\u5931\u8D25") };
        } catch (error2) {
          return { ok: false, reason: String(error2?.message ?? error2) };
        }
      };
      const sendSkillWrite = async (request) => {
        if (typeof fetch !== "function") return { ok: false, reason: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch" };
        try {
          const response = await fetch(`/${NAME}/skills`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request)
          });
          if (response.status === 404 || response.status === 405) {
            return { ok: false, reason: "\u8FD9\u4E2A Host \u6CA1\u6709\u6280\u80FD\u5199\u5165\u8DEF\u7531\uFF08Host \u4FA7\u6539\u52A8\u9700\u8981\u91CD\u542F\u4E00\u6B21 DSH\uFF09" };
          }
          if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: "\u8BF7\u6C42\u672A\u88AB\u4FE1\u4EFB\uFF08\u8BF7\u4ECE DSH \u9762\u677F\u91CC\u64CD\u4F5C\uFF09" };
          }
          if (!response.ok) {
            let reason = `HTTP ${String(response.status)}`;
            try {
              const body = await response.json();
              if (typeof body?.reason === "string" && body.reason !== "") reason = body.reason;
            } catch {
            }
            return { ok: false, reason };
          }
          const result = await response.json();
          if (result?.ok === true) return { ok: true, reason: "" };
          return { ok: false, reason: String(result?.reason ?? "\u5199\u5165\u5931\u8D25") };
        } catch (error2) {
          return { ok: false, reason: String(error2?.message ?? error2) };
        }
      };
      const readSkillBody = async (path) => {
        if (typeof fetch !== "function") return { ok: false, reason: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch" };
        if (typeof path !== "string" || path === "") return { ok: false, reason: "\u6CA1\u6709\u6587\u4EF6\u8DEF\u5F84" };
        try {
          const response = await fetch(`/${NAME}/skill?path=${encodeURIComponent(path)}`, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (response.status === 404 || response.status === 405) {
            return { ok: false, reason: "\u8FD9\u4E2A Host \u6CA1\u6709\u6280\u80FD\u8BFB\u53D6\u8DEF\u7531\uFF08Host \u4FA7\u6539\u52A8\u9700\u8981\u91CD\u542F\u4E00\u6B21 DSH\uFF09" };
          }
          if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
          return await response.json();
        } catch (error2) {
          return { ok: false, reason: String(error2?.message ?? error2) };
        }
      };
      const sendReconnect = async ({ tier, serverName, scope }) => {
        if (typeof fetch !== "function") return { ok: false, reason: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch" };
        try {
          const response = await fetch(`/${NAME}/reconnect`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tier, serverName, scope })
          });
          if (response.status === 404 || response.status === 405) {
            return { ok: false, reason: "\u8FD9\u4E2A Host \u6CA1\u6709\u91CD\u8FDE\u8DEF\u7531\uFF08Host \u4FA7\u6539\u52A8\u9700\u8981\u91CD\u542F\u4E00\u6B21 DSH\uFF09" };
          }
          if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: "\u8BF7\u6C42\u672A\u88AB\u4FE1\u4EFB\uFF08\u8BF7\u4ECE DSH \u9762\u677F\u91CC\u64CD\u4F5C\uFF09" };
          }
          if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
          return await response.json();
        } catch (error2) {
          return { ok: false, reason: String(error2?.message ?? error2) };
        }
      };
      const scanImport = async ({ source, scope, project }) => {
        if (typeof fetch !== "function") return { ok: false, files: [], servers: [], error: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch" };
        try {
          const response = await fetch(`/${NAME}/import`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source, scope, project })
          });
          if (response.status === 404 || response.status === 405) {
            return { ok: false, files: [], servers: [], error: "\u8FD9\u4E2A Host \u6CA1\u6709\u5BFC\u5165\u626B\u63CF\u8DEF\u7531\uFF08Host \u4FA7\u6539\u52A8\u9700\u8981\u91CD\u542F\u4E00\u6B21 DSH\uFF09" };
          }
          if (response.status === 401 || response.status === 403) {
            return { ok: false, files: [], servers: [], error: "\u8BF7\u6C42\u672A\u88AB\u4FE1\u4EFB\uFF08\u8BF7\u4ECE DSH \u9762\u677F\u91CC\u64CD\u4F5C\uFF09" };
          }
          if (!response.ok) return { ok: false, files: [], servers: [], error: `HTTP ${response.status}` };
          return await response.json();
        } catch (error2) {
          return { ok: false, files: [], servers: [], error: String(error2?.message ?? error2) };
        }
      };
      const sendOAuth = async ({ action, serverName }) => {
        if (typeof fetch !== "function") return { ok: false, reason: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch\uFF0C\u65E0\u6CD5\u53D1\u8D77\u6388\u6743" };
        try {
          const response = await fetch(`/${NAME}/oauth`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, serverName })
          });
          if (response.status === 404 || response.status === 405) {
            return { ok: false, reason: "\u8FD9\u4E2A Host \u7248\u672C\u6CA1\u6709 OAuth \u901A\u9053\uFF08Host \u4FA7\u6539\u52A8\u9700\u8981\u91CD\u542F\u4E00\u6B21 DSH\uFF09" };
          }
          if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: "\u8BF7\u6C42\u672A\u88AB\u4FE1\u4EFB\uFF08\u8BF7\u4ECE DSH \u9762\u677F\u91CC\u64CD\u4F5C\uFF09" };
          }
          if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
          const result = await response.json();
          return result !== null && typeof result === "object" ? result : { ok: false, reason: "\u54CD\u5E94\u683C\u5F0F\u65E0\u6548" };
        } catch (error2) {
          return { ok: false, reason: String(error2?.message ?? error2) };
        }
      };
      const filterFor = (serverName) => {
        const rule = toolFilters[serverName];
        return {
          mode: rule?.mode === "allow" || rule?.mode === "deny" ? rule.mode : "off",
          tools: Array.isArray(rule?.tools) ? rule.tools : []
        };
      };
      const writeFilter = (serverName, next) => {
        const map = { ...toolFilters };
        if (next.mode === "off") delete map[serverName];
        else map[serverName] = { mode: next.mode, tools: next.tools };
        return write("toolFilters", map);
      };
      const leafOf = (serverName) => (fullName) => {
        const prefix = `mcp__${serverName}__`;
        return fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
      };
      const statusFor = (serverName, tier, scope) => {
        if (typeof serverName !== "string" || serverName === "") return null;
        const wantScope = scope ?? "";
        return serverStatus.find((item) => item.serverName === serverName && item.tier === tier && (item.scope ?? "") === wantScope) ?? serverStatus.find((item) => item.serverName === serverName && item.tier === tier) ?? null;
      };
      const STATUS_DOTS = {
        connected: { dot: "ok", text: "\u53EF\u7528" },
        // 「连接中」同时覆盖首次连接（pending）与断线重试（retrying）：对用户来说是同一件事
        // ——还在连。区分它们只会让标签更长，而两档都不需要用户动手。
        retrying: { dot: "warn", text: "\u8FDE\u63A5\u4E2D" },
        pending: { dot: "warn", text: "\u8FDE\u63A5\u4E2D" },
        "gave-up": { dot: "danger", text: "\u5DF2\u653E\u5F03\u91CD\u8BD5" },
        failed: { dot: "danger", text: "\u5F02\u5E38" },
        // 需要授权**不是故障**：受保护的服务器拒绝未授权连接是协议规定的正常行为，
        // 红色会让人去修一台根本没坏的服务器。黄 = 有一件事等你做。
        "needs-auth": { dot: "warn", text: "\u9700\u8981\u6388\u6743" },
        unmounted: { dot: "neutral", text: "\u672A\u6302\u8F7D" },
        disabled: { dot: "neutral", text: "\u5DF2\u5173\u95ED" },
        // 观测机制没装上时如实说「状态未知」。只在 Host 明确报告 unknown 时出现
        // （旧 Host 根本不发布 serverStatus，那种情况整个标签都不渲染）——
        // 因为「看不见」和「一切正常」长得一样，是这类告警最坏的失败方式。
        unknown: { dot: "neutral", text: "\u72B6\u6001\u672A\u77E5" }
      };
      const statusDot = (serverName, tier, scope) => {
        const item = statusFor(serverName, tier, scope) ?? (serverToolsError?.reason ? {
          status: "unknown",
          detail: serverToolsError.reason === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u8FDE\u63A5\u72B6\u6001" : serverToolsError.detail
        } : null);
        const spec = STATUS_DOTS[item?.status];
        if (spec === void 0) return null;
        const tools = item.status === "connected" && item.toolCount > 0 ? `${item.toolCount} \u4E2A\u5DE5\u5177` : "";
        const left = item.status === "retrying" && item.remainingSeconds > 0 ? `\u7EA6 ${item.remainingSeconds}s` : "";
        const trailing = [tools, left].filter((part) => part !== "");
        return /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-status", key: "status", title: item.detail || void 0 }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-dot", "data-dot": spec.dot, key: "d", "aria-hidden": "true" }), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-statusText", key: "t" }, spec.text), trailing.map((part, index) => /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-statusMeta", key: `m${index}` }, part)));
      };
      const reconnectAction = (serverName, tier, scope) => {
        const item = statusFor(serverName, tier, scope);
        const RECONNECTABLE = /* @__PURE__ */ new Set(["gave-up", "failed", "retrying", "pending"]);
        if (item === null || !RECONNECTABLE.has(item.status)) return null;
        const state = reconnectState[serverName] ?? {};
        const waiting = state.pending === true;
        const failure = String(state.error ?? "");
        return {
          node: /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-menuItem",
              key: "reconnect",
              disabled: busy || waiting,
              onClick: () => {
                setReconnectState((current) => ({ ...current, [serverName]: { pending: true, error: "" } }));
                void sendReconnect({ tier, serverName, scope: scope ?? "" }).then((result) => {
                  setReconnectState((current) => ({
                    ...current,
                    [serverName]: { pending: false, error: result.ok ? "" : String(result.reason ?? "\u91CD\u8FDE\u5931\u8D25") }
                  }));
                  if (result.ok) bumpRefresh();
                });
              }
            },
            waiting ? "\u91CD\u8FDE\u4E2D\u2026" : "\u91CD\u8FDE"
          ),
          failure
        };
      };
      const commandRowOp = (op, entryId) => {
        const key = inflightKeyForRow(entryId);
        void sendRowOp(op).then((result) => {
          if (result.ok) {
            setInflight((m) => m[key] === void 0 ? m : { ...m, [key]: { ...m[key], confirmed: true } });
            if (Array.isArray(result.servers)) {
              setRuntime((current) => ({ ...current, servers: result.servers }));
            }
            bumpRefresh();
            return;
          }
          setInflight((m) => {
            const next = { ...m };
            delete next[key];
            return next;
          });
          setError(result.reason);
        });
      };
      const enabledSwitch = (row) => {
        const key = inflightKeyForRow(row.entryId);
        const on = row.enabled !== false;
        const expected = inflight[key]?.kind === "toggle" ? inflight[key].expectEnabled : void 0;
        const shown = expected === void 0 ? on : expected;
        const toggle = (next) => {
          setInflight((m) => ({ ...m, [key]: { kind: "toggle", at: Date.now(), expectEnabled: next } }));
          commandRowOp(toggleServerOp(row.entryId, next), key);
        };
        const label = shown ? "\u505C\u7528" : "\u542F\u7528";
        return switchControl(shown, toggle, label, busy);
      };
      const moreMenu = (row, items) => {
        const open = menuFor === row.entryId;
        const visible = items.filter((item) => item !== null && item !== void 0);
        if (visible.length === 0) return null;
        return /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-more", key: "more" }, /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-moreTrigger",
            key: "t",
            type: "button",
            disabled: busy,
            "aria-haspopup": "menu",
            "aria-expanded": open,
            "aria-label": "\u66F4\u591A\u64CD\u4F5C",
            onClick: (event) => {
              if (open) {
                setMenuFor("");
                return;
              }
              const rect = event?.currentTarget?.getBoundingClientRect?.();
              setMenuAnchor(measureMenuAnchor({
                rect,
                // 每一版增删菜单项都会改变高度，所以按**当前**项数估，不写死数字。
                itemCount: visible.length,
                viewportWidth: globalThis.window?.innerWidth,
                viewportHeight: globalThis.window?.innerHeight
              }));
              setMenuFor(row.entryId);
            }
          },
          "\u22EF"
        ), open ? /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-menuScrim", key: "scrim", onClick: () => setMenuFor("") }), /* @__PURE__ */ __dshReact.createElement(
          "span",
          {
            className: "smp-menu",
            key: "menu",
            role: "menu",
            "data-placement": menuAnchor?.placement ?? "down",
            style: anchorStyle(menuAnchor)
          },
          visible
        )) : null);
      };
      const head = pageHead();
      const tabs = tabStrip({
        active: tab,
        counts: {
          // Count what the tab lists: one list, so one number. It used to sum three
          // arrays (panel-owned globals, profile globals, panel-owned projects) because
          // the tiers were stored separately.
          mcp: profileRows.length,
          // Count what the tab actually lists: the panel's own skills plus the ones
          // discovered on disk (that is why it used to read 0 while cards showed). Both
          // halves are now cross-workspace, so the number matches the list on screen.
          skills: discoveredOnly.length
        },
        onSelect: (next) => {
          setTab(next);
          setEditing(null);
          setExpanded("");
        }
      });
      const mcpAddButton = () => /* @__PURE__ */ __dshReact.createElement(
        "button",
        {
          className: "smp-button",
          "data-variant": "primary",
          key: "add",
          disabled: busy,
          onClick: () => {
            setEditing({ kind: "mcp", tier: "global", id: void 0 });
            setDraft({
              transport: "streamable-http",
              command: HINTS.command,
              ...CONNECTION_DRAFT_DEFAULTS
            });
            setScopeDraft({ value: defaultWorkspace(), custom: false });
          }
        },
        "\u6DFB\u52A0\u670D\u52A1\u5668"
      );
      const skillsAddButton = () => /* @__PURE__ */ __dshReact.createElement(
        "button",
        {
          className: "smp-button",
          "data-variant": "primary",
          key: "add",
          disabled: busy,
          onClick: () => {
            setSkillError("");
            setSkillDraft({ name: "", description: "", body: "" });
            resetSkillPending();
            setSkillDialog({
              mode: "add",
              scope: "global",
              id: "dsh",
              // Remembered for when the tier is switched to 项目级: the workspace the user is
              // working in is almost always the one meant, but it is not preselected while the
              // destination is a user-level root.
              project: defaultWorkspace(),
              projectCustom: false,
              prevName: ""
            });
          }
        },
        "\u6DFB\u52A0\u6280\u80FD"
      );
      const filterRowView = filterRow({
        query,
        onQuery: setQuery,
        // Neither tab has a project switch: MCP never needed one (a server's scope is chosen in
        // its own form) and skills no longer do either (the list shows every workspace at once,
        // and a skill's workspace is chosen in the add dialog).
        placeholder: tab === "mcp" ? "\u641C\u7D22\u540D\u79F0" : "\u641C\u7D22\u6280\u80FD\u540D\u79F0",
        // Both tabs put their primary action on this row, in the same slot: the trigger and
        // the list it appends to stay on one screen. (MCP used to keep its form at the
        // bottom of the list while this button sat at the top, so the click looked inert.)
        actions: tab === "mcp" ? mcpAddButton() : skillsAddButton()
      });
      function needsAuthNote(serverName, tier, scope) {
        const item = statusFor(serverName, tier, scope);
        if (item?.status !== "needs-auth") return null;
        const why = String(item.detail ?? "") || "\u8FD9\u53F0\u670D\u52A1\u5668\u8981\u6C42\u5148\u6388\u6743\uFF08OAuth\uFF09\u624D\u80FD\u8FDE\u63A5\uFF0C\u8FD9\u4E0D\u662F\u6545\u969C\u3002";
        const ready = oauthState?.ready === true;
        if (!ready) {
          const reason = String(oauthState?.detail ?? "");
          return /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "needsAuth", style: { marginTop: 6 } }, `${why} OAuth \u6388\u6743\u5728\u8FD9\u4E2A Host \u4E0A\u4E0D\u53EF\u7528${reason === "" ? "" : `\uFF08${reason}\uFF09`}\uFF0C\u6240\u4EE5\u53EA\u80FD\u9760\u51ED\u636E\u8865\u4E0A\uFF1A\u7ED9\u8FD9\u4E00\u884C\u52A0\u4E00\u4E2A Authorization \u8BF7\u6C42\u5934\uFF0C\u6216\u6362\u6210\u670D\u52A1\u5668\u63D0\u4F9B\u7684\u5E26 token \u7684\u5730\u5740\u3002`);
        }
        const failure = oauthFailureFor(serverName);
        const pending = oauthPending === serverName;
        const status = oauthServerState(serverName);
        return /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-note", key: "needsAuth", style: { marginTop: 6 } }, /* @__PURE__ */ __dshReact.createElement("p", { style: { margin: 0 } }, why), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-oauthRow" }, /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-button",
            "data-variant": "primary",
            type: "button",
            disabled: pending,
            onClick: () => void startOAuth(serverName)
          },
          pending ? "\u6B63\u5728\u83B7\u53D6\u6388\u6743\u94FE\u63A5\u2026" : status.present ? "\u91CD\u65B0\u6388\u6743" : "\u6388\u6743"
        ), status.present && status.refreshable === true ? /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-button",
            type: "button",
            disabled: pending,
            onClick: () => void revokeOAuth(serverName)
          },
          "\u6E05\u9664\u51ED\u636E"
        ) : null), status.present === true && failure === "" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", style: { margin: "4px 0 0" } }, "\u5DF2\u7ECF\u4FDD\u5B58\u4E86\u6388\u6743\u51ED\u636E\uFF0C\u4F46\u8FD9\u53F0\u670D\u52A1\u5668\u4ECD\u7136\u62D2\u7EDD\u4E86\u8FDE\u63A5\u3002\u53EF\u80FD\u662F\u4EE4\u724C\u88AB\u64A4\u9500\u3001\u6216\u670D\u52A1\u5668\u7AEF\u7684\u9274\u6743\u914D\u7F6E\u53D8\u4E86 \u2014\u2014 \u91CD\u65B0\u6388\u6743\u901A\u5E38\u80FD\u89E3\u51B3\uFF1B\u82E5\u53CD\u590D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5668\u662F\u5426\u8FD8\u8981\u6C42\u5176\u5B83\u7684\u8BF7\u6C42\u5934\u3002") : null, failure === "" ? null : /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note smp-oauthError", style: { margin: "4px 0 0" } }, failure), authorizeUrlFor(serverName) === "" ? null : /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-oauthLink" }, /* @__PURE__ */ __dshReact.createElement("p", { style: { margin: "6px 0 2px" } }, "\u5728\u6D4F\u89C8\u5668\u91CC\u6253\u5F00\u8FD9\u4E2A\u94FE\u63A5\u5B8C\u6210\u767B\u5F55\uFF0C\u5B8C\u6210\u540E\u56DE\u5230\u8FD9\u91CC\uFF1A"), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-oauthLinkRow" }, /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-oauthUrl",
            readOnly: true,
            value: authorizeUrlFor(serverName),
            onFocus: (event) => event.target.select()
          }
        ), /* @__PURE__ */ __dshReact.createElement("button", { className: "smp-button", "data-variant": "outline", type: "button", onClick: () => copyAuthorizeUrl(serverName) }, copiedUrlFor === serverName ? "\u5DF2\u590D\u5236" : "\u590D\u5236\u94FE\u63A5")), /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", style: { margin: "2px 0 0" } }, "\u6388\u6743\u5B8C\u6210\u540E\u5982\u679C\u72B6\u6001\u6CA1\u53D8\uFF0C\u70B9\u4E00\u6B21\u300C\u91CD\u8FDE\u300D\u8BA9\u5B83\u91CD\u65B0\u5EFA\u7ACB\u8FDE\u63A5\u3002")));
      }
      function card(key, identity, description, enabled, details, menuItems, pending, statusNode, authNote) {
        const isOpen = expanded === key;
        return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardRow", key: "row" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardMain", key: "main" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-cardToggle",
            key: "toggle",
            "aria-expanded": isOpen,
            onClick: () => setExpanded(isOpen ? "" : key)
          },
          /* @__PURE__ */ __dshReact.createElement(Chevron, { key: "c", open: isOpen }),
          /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardIdentity", key: "id" }, identity)
        ), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardEnd", key: "end" }, enabled === false ? null : statusNode ?? null)), description ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "desc" }, description) : null), pending ? /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardActions", key: "pending" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-pending", key: "p" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-spinner", key: "s" }), pending)) : /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardActions", key: "actions" }, moreMenu({ entryId: key }, menuItems))), isOpen ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDetails", key: "details" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-details", key: "grid" }, detailNodes(details, "k")), authNote ?? null, error ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-error", key: "err", style: { marginTop: 8 } }, error) : null) : null);
      }
      function profileCard(row, tier = "global") {
        const isGlobalTier = tier === "global";
        const rowKey = `profile:${row.entryId}`;
        const rowOpen = expanded === rowKey;
        const rowStatusScope = isGlobalTier ? "" : row.scope ?? "";
        if (editing?.kind === "mcp" && editing.tier === tier && editing.id === row.entryId) {
          return serverForm({ tier, scope: row.scope ?? "global" });
        }
        const inflightInfo = inflight[inflightKeyForRow(row.entryId)];
        const spinning = inflightInfo !== void 0 && inflightInfo.confirmed !== true && inflightInfo.kind !== "toggle";
        const pending = pendingOf(row.entryId) !== null || spinning;
        const reconnect = reconnectAction(row.serverName, tier, rowStatusScope);
        const oauthCredentials = oauthServerState(row.serverName);
        const oauthRowStatus = statusFor(row.serverName, tier, rowStatusScope);
        const oauthWorthOffering = oauthCredentials.present === true ? oauthRowStatus?.status !== "connected" : oauthRowStatus === null || oauthRowStatus.status === "needs-auth";
        const oauthMenuItem = oauthState?.ready === true && row.transport === "streamable-http" && oauthWorthOffering ? /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-menuItem",
            key: "oauth",
            disabled: busy || oauthPending !== "",
            onClick: () => {
              setMenuFor("");
              void startOAuth(row.serverName);
            }
          },
          oauthPending === row.serverName ? "\u6B63\u5728\u83B7\u53D6\u6388\u6743\u94FE\u63A5\u2026" : oauthServerState(row.serverName).present ? "\u91CD\u65B0\u6388\u6743" : "\u6388\u6743"
        ) : null;
        const menuItems = [
          reconnect === null ? null : reconnect.node,
          oauthMenuItem,
          /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-menuItem",
              key: "edit",
              disabled: busy,
              onClick: () => {
                setMenuFor("");
                setEditing({ kind: "mcp", tier, profile: row.entryId, id: row.entryId, original: row });
                setDraft(draftFromRow(row));
                const rowScope = row.scope && row.scope !== "global" ? row.scope : "";
                setScopeDraft({
                  value: rowScope,
                  custom: rowScope !== "" && !projectChoices.some(([path]) => path === rowScope)
                });
              }
            },
            "\u7F16\u8F91"
          ),
          /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-menuItem",
              "data-variant": "danger",
              key: "del",
              disabled: busy,
              onClick: () => {
                setMenuFor("");
                const run = () => {
                  setInflight((m) => ({ ...m, [inflightKeyForRow(row.entryId)]: { kind: "delete", at: Date.now() } }));
                  commandRowOp(deleteServerOp(row.entryId), row.entryId);
                };
                if (primitives?.Modal === void 0) {
                  if (window.confirm(`\u5220\u9664\u300C${row.serverName || row.entryId}\u300D\uFF1F`)) run();
                  return;
                }
                setDeleteDialog({
                  label: row.serverName || row.entryId,
                  note: "\u4F1A\u4ECE cordis.patch.yml \u91CC\u79FB\u9664\u8FD9\u4E00\u884C\uFF08\u5199\u5165\u524D\u81EA\u52A8\u5907\u4EFD\uFF09\u3002",
                  // Row ops report progress on the row itself (spinner + label),
                  // so this dialog closes immediately on confirm.
                  closeOnConfirm: true,
                  run
                });
              }
            },
            "\u5220\u9664"
          ),
          reconnect?.failure ? /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-menuError", key: "reconnectError" }, reconnect.failure) : null
        ];
        return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key: `profile:${row.entryId}` }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardRow", key: "row" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardMain", key: "main" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-cardToggle",
            key: "toggle",
            "aria-expanded": rowOpen,
            onClick: () => setExpanded(rowOpen ? "" : rowKey)
          },
          /* @__PURE__ */ __dshReact.createElement(Chevron, { key: "c", open: rowOpen }),
          /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardIdentity", key: "name" }, row.serverName || row.entryId, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-tag", "data-tone": "neutral", key: "scope" }, scopeTagLabel(row.scope)))
        ), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardEnd", key: "end" }, row.enabled === false ? null : statusDot(row.serverName, tier, rowStatusScope))), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "desc" }, row.target ? `${row.transport || "streamable-http"} \xB7 ${row.target}` : `${String(row.entryId).replace(/^include:/, "")}${row.phase ? ` \xB7 ${row.phase}` : ""}`)), pending ? /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardActions", key: "pending" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-pending", key: "p" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-spinner", key: "s" }), pendingLabel(inflight[inflightKeyForRow(row.entryId)] ?? { kind: pendingOf(row.entryId)?.op }))) : rowOpsReady ? /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardActions", key: "actions" }, enabledSwitch(row), moreMenu(row, menuItems)) : null), rowOpen ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDetails", key: "details" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-details", key: "grid" }, detailNodes(rowDetailPairs(row))), toolListNode(toolsForServer(serverTools, row.serverName, serverToolsError), `tools-${row.entryId}`, {
          ...filterFor(row.serverName),
          leafOf: leafOf(row.serverName),
          onMode: (mode) => {
            const current = filterFor(row.serverName);
            void writeFilter(row.serverName, { mode, tools: current.tools });
          },
          onToggle: (leaf, checked) => {
            const current = filterFor(row.serverName);
            const next = checked ? [.../* @__PURE__ */ new Set([...current.tools, leaf])] : current.tools.filter((name) => name !== leaf);
            void writeFilter(row.serverName, { mode: current.mode, tools: next });
          }
        }), filterState.installed !== true ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "filterOff", style: { marginTop: 6 } }, `\u5DE5\u5177\u8FC7\u6EE4\u5F53\u524D\u672A\u751F\u6548${filterState.reason ? `\uFF1A${filterState.reason}` : ""}\u2014\u2014\u52FE\u9009\u4F1A\u88AB\u4FDD\u5B58\uFF0C\u4F46\u8981\u7B49\u5B83\u53EF\u7528\u540E\u624D\u4F1A\u771F\u6B63\u6321\u4F4F\u5DE5\u5177\u3002`) : null, needsAuthNote(row.serverName, tier, rowStatusScope), filterState.installed === true && filterFor(row.serverName).mode !== "off" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "filterSync", style: { marginTop: 6 } }, "\u6539\u52A8\u4F1A\u5728\u8BE5\u670D\u52A1\u5668\u91CD\u65B0\u6CE8\u518C\u5DE5\u5177\u65F6\u5B8C\u5168\u751F\u6548\u3002\u60F3\u7ACB\u523B\u770B\u5230\u6548\u679C\uFF1A\u628A\u8FD9\u5F20\u5361\u7247\u300C\u505C\u7528\u300D\u518D\u300C\u542F\u7528\u300D\uFF08\u51E0\u79D2\u5373\u53EF\uFF09\uFF0C\u6216\u91CD\u542F DSH\u2014\u2014\u63D2\u4EF6\u65E0\u6CD5\u6CE8\u9500\u522B\u7684\u63D2\u4EF6\u5DF2\u7ECF\u6CE8\u518C\u7684\u5DE5\u5177\uFF0C\u800C\u300C\u505C\u7528\u300D\u4F1A\u8FDE\u5E26\u6CE8\u9500\u5B83\u7684\u5DE5\u5177\u3002") : null, filterState.installed === true && Array.isArray(filterState.preExisting) && filterState.preExisting.length > 0 ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "filterLate", style: { marginTop: 6 } }, `\u6709 ${filterState.preExisting.length} \u4E2A MCP \u5DE5\u5177\u5728\u8FC7\u6EE4\u751F\u6548\u524D\u5C31\u5DF2\u6CE8\u518C\uFF0C\u5B83\u4EEC\u65E0\u6CD5\u518D\u88AB\u6321\u4E0B\uFF08\u91CD\u542F DSH \u540E\u4F1A\u5F7B\u5E95\u751F\u6548\uFF09\u3002`) : null) : null);
      }
      const importCard = (scope) => {
        const target = scope === "global" ? "" : importProject;
        const raw = importScan;
        const result = raw !== null && typeof raw === "object" && raw.scope === scope && (scope === "global" || raw.project === target) ? raw : null;
        const needsProject = scope === "project" && target === "";
        const takenNames2 = takenNames({ scope, target, profileRows });
        const { fresh: freshServers, skipped: skippedServers } = splitImport(result?.servers ?? [], takenNames2);
        if (!importOpen) {
          return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key: "import" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardIdentity", key: "t" }, scope === "global" ? "\u5BFC\u5165 MCP" : "\u5BFC\u5165 MCP"), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardActions", key: "a" }, /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-button",
              "data-variant": "outline",
              key: "go",
              disabled: busy,
              onClick: () => setImportOpen(true)
            },
            "\u9009\u62E9\u6765\u6E90"
          ))), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "d" }, scope === "global" ? "\u4ECE\u5176\u4ED6\u7F16\u8F91\u5668/CLI \u7684\u7528\u6237\u7EA7\u914D\u7F6E\u6587\u4EF6\u5BFC\u5165\uFF08\u5199\u6210\u914D\u7F6E\u6587\u4EF6\u884C\uFF09\u3002" : "\u4ECE\u5176\u4ED6\u7F16\u8F91\u5668/CLI \u7684\u9879\u76EE\u7EA7\u6587\u4EF6\u5BFC\u5165\u5230\u9762\u677F\u7684\u9879\u76EE\u6761\u76EE\u3002"));
        }
        return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key: "import" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardIdentity", key: "t" }, scope === "global" ? "\u5BFC\u5165\u5168\u5C40 MCP" : "\u5BFC\u5165\u9879\u76EE MCP"), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardActions", key: "a" }, /* @__PURE__ */ __dshReact.createElement("button", { className: "smp-button", "data-variant": "outline", key: "close", onClick: () => setImportOpen(false) }, "\u6536\u8D77"))), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-segment", key: "segment" }, /* @__PURE__ */ __dshReact.createElement("button", { key: "g", "data-active": String(scope === "global"), onClick: () => setImportScope("global") }, "\u5168\u5C40"), /* @__PURE__ */ __dshReact.createElement("button", { key: "p", "data-active": String(scope === "project"), onClick: () => setImportScope("project") }, "\u9879\u76EE\u7EA7")), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-formGrid", key: "grid" }, field("\u6765\u6E90", /* @__PURE__ */ __dshReact.createElement("select", { className: "smp-select", value: importSource, onChange: (event) => setImportSource(event.target.value) }, IMPORT_CHOICES.map(([id, label]) => /* @__PURE__ */ __dshReact.createElement("option", { value: id, key: id }, label)))), scope === "global" ? null : importCustomProject ? field("\u9879\u76EE\u8DEF\u5F84", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-actionsRow", style: { marginTop: 0 } }, /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            placeholder: "\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84",
            style: { flex: "1 1 auto" },
            value: importProject,
            onChange: (event) => setImportProject(event.target.value)
          }
        ), /* @__PURE__ */ __dshReact.createElement("button", { className: "smp-button", "data-variant": "outline", key: "back", onClick: () => setImportCustomProject(false) }, "\u9009\u5DE5\u4F5C\u533A"))) : field("\u9879\u76EE", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-actionsRow", style: { marginTop: 0 } }, /* @__PURE__ */ __dshReact.createElement(
          "select",
          {
            className: "smp-select",
            value: importProject,
            style: { flex: "1 1 auto" },
            onChange: (event) => {
              if (event.target.value === "__custom__") {
                setImportCustomProject(true);
                return;
              }
              setImportProject(event.target.value);
            }
          },
          /* @__PURE__ */ __dshReact.createElement("option", { value: "", key: "none" }, "\u9009\u62E9\u4E00\u4E2A\u5DE5\u4F5C\u533A\u2026"),
          projectChoices.map(([path, title]) => /* @__PURE__ */ __dshReact.createElement("option", { value: path, key: path }, title)),
          /* @__PURE__ */ __dshReact.createElement("option", { value: "__custom__", key: "custom" }, "\u81EA\u5B9A\u4E49\u8DEF\u5F84\u2026")
        ), importProject !== "" ? /* @__PURE__ */ __dshReact.createElement("button", { className: "smp-button", "data-variant": "outline", key: "clear", onClick: () => setImportProject("") }, "\u6E05\u9664") : null))), needsProject ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "need" }, "\u5148\u9009\u62E9\u4E00\u4E2A\u5DE5\u4F5C\u533A\uFF08\u6216\u5207\u5230\u300C\u5168\u5C40\u300D\u8BFB\u7528\u6237\u7EA7\u914D\u7F6E\uFF09\u3002") : result === null ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "hint" }, "\u70B9\u300C\u626B\u63CF\u300D\u540E\uFF0C\u4F1A\u628A\u8BE5\u5DE5\u5177\u5728\u9879\u76EE\u91CC\u7684 MCP \u6587\u4EF6\u4E0E\u80FD\u5BFC\u5165\u7684\u6761\u76EE\u5217\u51FA\u6765\u3002") : /* @__PURE__ */ __dshReact.createElement("div", { key: "result" }, result.files.map((file) => /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: file.path }, `${file.exists ? "\u2713" : "\u2717"} ${file.path}${file.exists ? ` \xB7 \u8BC6\u522B ${file.servers.length} \u4E2A${file.unsupported > 0 ? `\uFF08${file.unsupported} \u4E2A\u5F62\u6001\u4E0D\u652F\u6301\uFF09` : ""}` : " \xB7 \u6587\u4EF6\u4E0D\u5B58\u5728"}${file.error !== null && file.error !== "" ? ` \xB7 ${file.error}` : ""}`)), result.error !== null && result.error !== "" ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-error", key: "err" }, result.error) : null, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "sum" }, `\u65B0\u589E ${freshServers.length} \u4E2A\uFF1A${freshServers.map((server) => server.serverName).join("\u3001") || "\u2014"}`), skippedServers.length > 0 ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "skip" }, `\u5DF2\u5B58\u5728 ${skippedServers.length} \u4E2A\uFF08\u8DF3\u8FC7\uFF0C\u4E0D\u8986\u76D6\uFF09\uFF1A${skippedServers.map((server) => server.serverName).join("\u3001")}`) : null), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-actionsRow", key: "actions" }, /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-button",
            "data-variant": "primary",
            key: "scan",
            disabled: busy || scope === "project" && target === "",
            onClick: () => {
              setBusy(true);
              setError("");
              void scanImport({ source: importSource, scope, project: target }).then((payload) => {
                setImportScan(payload);
                setBusy(false);
                if (payload?.ok !== true) setError(String(payload?.error ?? "\u626B\u63CF\u5931\u8D25"));
              });
            }
          },
          "\u626B\u63CF"
        ), result !== null && freshServers.length > 0 ? /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-button",
            "data-variant": "outline",
            key: "do",
            onClick: () => {
              const wantedScope = scope === "global" ? "global" : target;
              const existing = new Set(profileRows.filter((row) => (row.scope ?? "global") === wantedScope).map((row) => row.serverName));
              for (const server of result.servers) {
                if (existing.has(server.serverName)) continue;
                void sendRowOp(addServerOp({
                  serverName: server.serverName,
                  transport: server.transport,
                  url: server.transport === "stdio" ? "" : server.url,
                  command: server.transport === "stdio" ? server.command : "",
                  args: server.transport === "stdio" ? (server.args ?? []).join(" ") : "",
                  env: server.env ?? "",
                  headers: server.headers ?? "",
                  scope: scope === "global" ? "" : target,
                  scopeChanged: scope !== "global"
                })).then((outcome) => {
                  if (!outcome.ok) setError(outcome.reason);
                });
              }
              setImportScan(null);
            }
          },
          importLabel({ scope, fresh: freshServers.length, skipped: skippedServers.length })
        ) : null));
      };
      function serverForm(tier) {
        if (!editing || editing.kind !== "mcp" || editing.tier !== tier.tier) return null;
        const scope = tier.scope;
        const profileEntry = typeof editing.profile === "string" && editing.profile !== "" ? editing.profile : null;
        const stdio = (draft.transport ?? "streamable-http") === "stdio";
        return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key: "form", "data-wide": "true" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDetails", key: "body" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-formGrid", key: "grid" }, field("\u540D\u79F0\uFF08serverName\uFF09", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            placeholder: "\u4F8B\u5982 test\uFF0C\u6700\u591A 32 \u5B57\u7B26",
            value: draft.serverName ?? "",
            onChange: (e) => setDraft({ ...draft, serverName: e.target.value })
          }
        )), field("\u4F20\u8F93", /* @__PURE__ */ __dshReact.createElement(
          "select",
          {
            className: "smp-select",
            value: draft.transport ?? "streamable-http",
            onChange: (e) => {
              const transport = e.target.value;
              const blank = String(draft.command ?? "").trim() === "";
              setDraft({
                ...draft,
                transport,
                ...transport === "stdio" && blank ? { command: HINTS.command } : {}
              });
            }
          },
          /* @__PURE__ */ __dshReact.createElement("option", { value: "streamable-http", key: "h" }, "streamable-http"),
          /* @__PURE__ */ __dshReact.createElement("option", { value: "stdio", key: "s" }, "stdio")
        )), field("\u4F5C\u7528\u57DF\uFF08\u54EA\u4E2A\u5DE5\u4F5C\u533A\u53EF\u7528\uFF09", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-scopePick", key: "scope" }, /* @__PURE__ */ __dshReact.createElement(
          "select",
          {
            className: "smp-select",
            key: "sel",
            value: scopeDraft.custom ? "__custom__" : scopeDraft.value || "global",
            onChange: (e) => {
              const value = e.target.value;
              if (value === "__custom__") {
                setScopeDraft({ value: "", custom: true });
                return;
              }
              setScopeDraft({ value: value === "global" ? "" : value, custom: false });
            }
          },
          /* @__PURE__ */ __dshReact.createElement("option", { value: "global", key: "g" }, "\u5168\u5C40 \u2014\u2014 \u6240\u6709\u5DE5\u4F5C\u533A\u90FD\u80FD\u7528"),
          projectChoices.map(([path, title]) => /* @__PURE__ */ __dshReact.createElement("option", { value: path, key: path }, title)),
          /* @__PURE__ */ __dshReact.createElement("option", { value: "__custom__", key: "c" }, "\u81EA\u5B9A\u4E49\u8DEF\u5F84\u2026")
        ), scopeDraft.custom ? /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            key: "custom",
            placeholder: "\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84",
            value: scopeDraft.value,
            onChange: (e) => setScopeDraft({ ...scopeDraft, value: e.target.value })
          }
        ) : null)), stdio ? field("\u547D\u4EE4", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            placeholder: HINTS.command,
            value: draft.command ?? "",
            onChange: (e) => setDraft({ ...draft, command: e.target.value })
          }
        )) : field("URL", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            placeholder: HINTS.url,
            value: draft.url ?? "",
            onChange: (e) => setDraft({ ...draft, url: e.target.value })
          }
        )), stdio ? null : field("\u8BF7\u6C42\u5934\uFF08KEY=VALUE\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF09", /* @__PURE__ */ __dshReact.createElement(
          "textarea",
          {
            className: "smp-textarea",
            rows: 3,
            placeholder: HINTS.headers,
            value: draft.headers ?? "",
            onChange: (e) => setDraft({ ...draft, headers: e.target.value })
          }
        ), true), stdio ? field("\u53C2\u6570\uFF08\u7A7A\u683C\u5206\u9694\uFF09", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            placeholder: HINTS.args,
            value: draft.args ?? "",
            onChange: (e) => setDraft({ ...draft, args: e.target.value })
          }
        )) : null, stdio && tier.tier !== "global" ? field("\u8FD0\u884C\u65F6", /* @__PURE__ */ __dshReact.createElement(
          "select",
          {
            className: "smp-select",
            value: draft.runtime ?? "auto",
            onChange: (e) => setDraft({ ...draft, runtime: e.target.value })
          },
          /* @__PURE__ */ __dshReact.createElement("option", { value: "auto", key: "auto" }, "\u8DDF\u968F Harness\uFF08\u81EA\u5E26 node + pnpx\uFF0C\u63A8\u8350\uFF09"),
          /* @__PURE__ */ __dshReact.createElement("option", { value: "system", key: "system" }, "\u7CFB\u7EDF npx\uFF08\u4E2A\u522B\u8001\u5305\u4E0D\u517C\u5BB9 pnpm\uFF09")
        )) : null, stdio ? field("\u73AF\u5883\u53D8\u91CF\uFF08KEY=VALUE\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF09", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-envField", key: "env" }, /* @__PURE__ */ __dshReact.createElement(
          "textarea",
          {
            className: "smp-textarea",
            rows: 3,
            placeholder: HINTS.env,
            value: draft.env ?? "",
            onChange: (e) => setDraft({ ...draft, env: e.target.value })
          }
        ), hasInjectedPath(draft.env) ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "pathNote" }, "\u5176\u4E2D\u7684 ", /* @__PURE__ */ __dshReact.createElement("code", null, "PATH"), " \u662F DSH \u81EA\u52A8\u6CE8\u5165\u7684\uFF08\u8DDF\u968F\u7CFB\u7EDF PATH\uFF0C\u8BA9 ", /* @__PURE__ */ __dshReact.createElement("code", null, "npx"), "/", /* @__PURE__ */ __dshReact.createElement("code", null, "node"), " \u80FD\u88AB\u627E\u5230\uFF09\u2014\u2014\u4FDD\u6301\u539F\u6837\u5373\u53EF\uFF0C\u5220\u6389\u4F1A\u8BA9\u8FD9\u4E2A stdio \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25\u3002") : null), true) : null, field("\u8FDE\u63A5\u5931\u8D25\u5904\u7406", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-switchRow", key: "fail" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchRowText" }, "\u8FDE\u4E0D\u4E0A\u65F6\u62D2\u7EDD\u6FC0\u6D3B\uFF08failOnStartupError\uFF09", /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchRowHint" }, "\u9ED8\u8BA4\u5173\u95ED")), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchSlot", key: "slot" }, switchControl(
          draft.failOnStartupError === true,
          (next) => setDraft({ ...draft, failOnStartupError: next }),
          "\u8FDE\u4E0D\u4E0A\u65F6\u62D2\u7EDD\u6FC0\u6D3B\uFF08failOnStartupError\uFF09"
        ))), true), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-divider", role: "separator", "aria-orientation": "horizontal", key: "divider" }), field("\u5185\u7F51 OAuth\uFF08\u4EC5 http \u6388\u6743\u670D\u52A1\u5668\uFF09", /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-switchRow", key: "allowInsecure" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchRowText" }, "\u5141\u8BB8\u660E\u6587 token \u7AEF\u70B9", /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchRowHint" }, "\u4EC5\u5F53\u6388\u6743\u670D\u52A1\u5668\u6CA1\u6709 TLS \u65F6\u6253\u5F00\uFF1B\u5F00\u542F\u540E access_token / refresh_token \u4F1A\u4EE5\u660E\u6587\u53D1\u5230\u5185\u7F51\uFF0C\u540C\u7F51\u6BB5\u53EF\u88AB\u55C5\u63A2")), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-switchSlot", key: "slot" }, switchControl(
          draft.allowInsecureTokenEndpoint === true,
          (next) => setDraft({ ...draft, allowInsecureTokenEndpoint: next }),
          "\u5141\u8BB8\u660E\u6587 token \u7AEF\u70B9"
        ))), true), field("\u5DE5\u5177\u8C03\u7528\u8D85\u65F6\uFF08ms\uFF09", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            type: "number",
            min: 1,
            step: 1,
            placeholder: String(CONNECTION_DRAFT_DEFAULTS.toolCallTimeoutMs),
            value: draft.toolCallTimeoutMs ?? "",
            onChange: (e) => setDraft({ ...draft, toolCallTimeoutMs: e.target.value })
          }
        )), field("\u91CD\u8FDE\u9996\u6B21\u5EF6\u8FDF\uFF08ms\uFF09", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            type: "number",
            min: 1,
            step: 1,
            placeholder: String(CONNECTION_DRAFT_DEFAULTS.reconnectInitialDelayMs),
            value: draft.reconnectInitialDelayMs ?? "",
            onChange: (e) => setDraft({ ...draft, reconnectInitialDelayMs: e.target.value })
          }
        )), field("\u91CD\u8FDE\u6700\u5927\u5EF6\u8FDF\uFF08ms\uFF09", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            type: "number",
            min: 1,
            step: 1,
            placeholder: String(CONNECTION_DRAFT_DEFAULTS.reconnectMaxDelayMs),
            value: draft.reconnectMaxDelayMs ?? "",
            onChange: (e) => setDraft({ ...draft, reconnectMaxDelayMs: e.target.value })
          }
        )), field("\u91CD\u8FDE\u6700\u5927\u6B21\u6570", /* @__PURE__ */ __dshReact.createElement(
          "input",
          {
            className: "smp-input",
            type: "number",
            min: 1,
            step: 1,
            placeholder: String(CONNECTION_DRAFT_DEFAULTS.reconnectMaxAttempts),
            value: draft.reconnectMaxAttempts ?? "",
            onChange: (e) => setDraft({ ...draft, reconnectMaxAttempts: e.target.value })
          }
        ))), error ? /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-error", key: "err", style: { marginTop: 8 } }, error) : null, profileEntry !== null ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-note", key: "note", style: { marginTop: 8 } }, `\u6539\u7684\u662F\u914D\u7F6E\u6587\u4EF6\u884C ${profileEntry.replace(/^include:/, "")}\uFF0CHost \u4F1A\u5199\u56DE profile patch\uFF08\u81EA\u52A8\u5907\u4EFD\uFF09\u3002`) : null, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-actionsRow", key: "actions" }, /* @__PURE__ */ __dshReact.createElement(
          "button",
          {
            className: "smp-button",
            "data-variant": "primary",
            key: "save",
            disabled: busy || !draft.serverName,
            onClick: () => {
              const transport = draft.transport ?? "streamable-http";
              const argList = String(draft.args ?? "").trim() === "" ? [] : String(draft.args).trim().split(/\s+/);
              if (profileEntry !== null) {
                setInflight((m) => ({ ...m, [inflightKeyForRow(profileEntry)]: { kind: "update", at: Date.now(), expectName: draft.serverName ?? "" } }));
                commandRowOp(updateServerOp(profileEntry, {
                  ...draft,
                  serverName: draft.serverName ?? "",
                  transport,
                  url: transport === "stdio" ? "" : draft.url ?? "",
                  command: transport === "stdio" ? draft.command ?? "" : "",
                  args: transport === "stdio" ? String(draft.args ?? "") : "",
                  env: transport === "stdio" ? String(draft.env ?? "") : "",
                  headers: transport === "stdio" ? "" : String(draft.headers ?? "")
                }, editing.original), profileEntry);
              } else {
                const optimisticKey = inflightKeyForRow(rowEntryId(draft.serverName));
                setInflight((m) => ({
                  ...m,
                  [optimisticKey]: {
                    kind: "add",
                    at: Date.now(),
                    scope: scopeDraft.value,
                    draft: { ...draft, transport }
                  }
                }));
                commandRowOp(addServerOp({
                  ...draft,
                  serverName: draft.serverName ?? "",
                  transport,
                  url: transport === "stdio" ? "" : draft.url ?? "",
                  command: transport === "stdio" ? draft.command ?? "" : "",
                  args: transport === "stdio" ? String(draft.args ?? "") : "",
                  env: transport === "stdio" ? String(draft.env ?? "") : "",
                  headers: transport === "stdio" ? "" : String(draft.headers ?? ""),
                  // The scope comes from the form's own picker: it is a property of
                  // this server, not of whatever the toolbar happened to be showing.
                  scope: scopeDraft.value,
                  scopeChanged: true
                }), optimisticKey);
              }
              setEditing(null);
            }
          },
          profileEntry !== null ? "\u4FDD\u5B58\u5230\u914D\u7F6E\u884C" : "\u4FDD\u5B58"
        ), /* @__PURE__ */ __dshReact.createElement("button", { className: "smp-button", "data-variant": "outline", key: "cancel", onClick: () => setEditing(null) }, "\u53D6\u6D88"))));
      }
      function diskSkillMenuItems(skill) {
        return [
          /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-menuItem",
              key: "view",
              disabled: busy || skillPendingPath === skill.path,
              onClick: () => {
                setMenuFor("");
                openPreview(skill);
              }
            },
            "\u9884\u89C8"
          ),
          /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-menuItem",
              key: "edit",
              disabled: busy || skillPendingPath === skill.path,
              onClick: () => {
                setMenuFor("");
                const parts = String(skill.source).split("-");
                const scope = parts[0] === "project" ? "project" : "global";
                const id = parts[1] === "dsh" ? "dsh" : "agents";
                setSkillError("");
                setSkillDraft({ name: skill.name, description: skill.description ?? "", body: skill.body ?? "" });
                resetSkillPending();
                setSkillDialog({
                  mode: "edit",
                  scope,
                  id,
                  project: skill.scope === "global" ? "" : skill.scope,
                  projectCustom: false,
                  prevName: skill.name,
                  path: skill.path ?? ""
                });
                loadSkillBody(skill);
              }
            },
            "\u7F16\u8F91"
          ),
          /* @__PURE__ */ __dshReact.createElement(
            "button",
            {
              className: "smp-menuItem",
              "data-variant": "danger",
              key: "del",
              disabled: busy || skillPendingPath === skill.path,
              onClick: () => {
                setMenuFor("");
                confirmDeleteSkill(skill);
              }
            },
            "\u5220\u9664"
          )
        ];
      }
      const pendingAdds2 = pendingAdds(inflight, profileRows);
      const skillGroups = orderedScopeGroups(
        discoveredOnly.map((skill) => ({ skill, scope: skill.scope ?? "global" })),
        workspacePaths
      );
      const skillCard = ({ skill }) => {
        const scopeValue = skill.scope ?? "global";
        const rootId = rootIdOfSource(skill.source);
        const key = `disk:${skill.path}`;
        const pending = skillPendingPath === skill.path ? "\u5220\u9664\u4E2D\u2026" : null;
        const identity = [
          /* @__PURE__ */ __dshReact.createElement("span", { key: "n" }, skill.name),
          /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-tag", "data-tone": "neutral", key: "scope" }, scopeTagLabel(scopeValue))
        ];
        return card(
          key,
          identity,
          skill.description || "(\u65E0\u63CF\u8FF0)",
          void 0,
          [["\u6765\u6E90", skill.source], ["\u8DEF\u5F84", skill.path]],
          diskSkillMenuItems(skill),
          pending
        );
      };
      const skillsList = /* @__PURE__ */ __dshReact.createElement("ul", { className: "smp-cards", key: "cards" }, skillGroups.map((group) => group.items.map((entry) => skillCard(entry))), skillGroups.length === 0 ? /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-empty", key: "empty", style: { gridColumn: "1 / -1" } }, emptySkillText("")) : null);
      const confirmDeleteSkill = (skill) => {
        const parts = String(skill.source ?? "").split("-");
        const scope = parts[0] === "project" ? "project" : "global";
        const id = parts[1] === "dsh" ? "dsh" : "agents";
        setDeleteDialog({
          label: skill.name,
          note: "\u4F1A\u5148\u628A\u76EE\u5F55\u5907\u4EFD\u5230\u540C\u7EA7\u7684 .smp-backup-* \u518D\u5220\u9664\uFF1B\u5907\u4EFD\u4F1A\u4FDD\u7559\uFF0C\u9700\u8981\u65F6\u53EF\u624B\u52A8\u6062\u590D\u3002",
          // Progress shows on the card itself, like MCP row deletes.
          closeOnConfirm: true,
          run: () => {
            const target = removalTargetOf(skill);
            deleteTargetRef.current = { ...target, path: String(skill.path ?? "") };
            setDeleteError("");
            setSkillPendingPath(String(skill.path ?? ""));
            setSkillError("");
            setSkillNonce("pending");
            const request = {
              op: "delete",
              scope,
              id,
              project: skill.scope === "global" ? "" : skill.scope,
              name: skill.name,
              prevName: "",
              description: "",
              body: "",
              path: skill.path ?? "",
              nonce: ""
            };
            void sendSkillWrite(request).then((result) => {
              setSkillNonce("");
              finishSkillDelete(result);
            });
          }
        });
      };
      const diskPathOfSkill = (skill) => {
        const name = String(skill?.name ?? "");
        if (name === "") return "";
        const scope = skill?.scope ?? "global";
        const rootId = skill?.id === "agents" ? "agents" : "dsh";
        const dirs = runtime.skillDirs ?? {};
        const base = scope === "global" ? String(rootId === "agents" ? dirs.userAgents ?? "" : dirs.userDsh ?? "") : `${String(scope).replace(/\/+$/, "")}/${rootId === "dsh" ? ".dsh" : ".agents"}/skills`;
        return base === "" ? "" : `${base}/${name}/SKILL.md`;
      };
      const loadSkillBody = (skill) => {
        if (!skill?.path) return;
        setEditBodyPending(true);
        setEditBodyNonce(nextNonce());
        void readSkillBody(skill.path).then((result) => {
          setSkillDraft((current) => ({
            ...current,
            body: result.ok === true ? String(result.body ?? "") : String(current.body ?? "")
          }));
          setEditBodyPending(false);
          setEditBodyNonce("");
          if (result.ok !== true) setSkillError(String(result.reason ?? "\u8BFB\u53D6\u6B63\u6587\u5931\u8D25"));
        });
      };
      const openPreview = (skill) => {
        setSkillPreview(skill);
        setPreviewBody("");
        setPreviewPending(true);
        setPreviewNonce(nextNonce());
        void readSkillBody(skill.path ?? "").then((result) => {
          setPreviewBody(result.ok === true ? String(result.body ?? "") : String(result.reason ?? "\u8BFB\u53D6\u5931\u8D25"));
          setPreviewPending(false);
          setPreviewNonce("");
        });
      };
      const skillDialogTarget = skillRootLabel(
        skillDialog?.scope === "project" ? skillDialog?.project ?? "" : "global",
        skillDialog?.id
      );
      const skillDialogElement = skillDialogView({
        dialog: skillDialog,
        draft: skillDraft,
        resolvedPath: skillDialog === null || skillDialog.scope === "project" && String(skillDialog.project ?? "") === "" ? "" : skillDialogTarget,
        workspaceChoices: projectChoices,
        error: skillError,
        pending: skillNonce !== "" || editBodyPending,
        primitives,
        onScope: (scope) => setSkillDialog((current) => current === null ? current : { ...current, scope }),
        onProject: (next) => setSkillDialog((current) => {
          if (current === null) return current;
          if (next === "__custom__") return { ...current, projectCustom: true };
          return { ...current, projectCustom: false, project: next };
        }),
        onProjectCustom: (next) => setSkillDialog((current) => current === null ? current : { ...current, project: next }),
        onRoot: (id) => setSkillDialog((current) => current === null ? current : { ...current, id: id === "agents" ? "agents" : "dsh" }),
        onName: (name) => setSkillDraft((current) => ({ ...current, name })),
        onDescription: (description) => setSkillDraft((current) => ({ ...current, description })),
        onBody: (body) => setSkillDraft((current) => ({ ...current, body })),
        onCancel: () => {
          setSkillDialog(null);
          setSkillError("");
          resetSkillPending();
        },
        onSave: () => {
          if (skillDialog === null) return;
          if (editBodyPending) return;
          const isEdit = skillDialog.mode === "edit";
          const renamed = isEdit && (skillDraft.name ?? "") !== skillDialog.prevName;
          const editOp = isEdit ? renamed ? "rename" : "update" : "create";
          const sent = {
            kind: editOp,
            name: String(skillDraft.name ?? ""),
            prevName: String(skillDialog.prevName ?? ""),
            description: String(skillDraft.description ?? ""),
            scope: skillDialog.scope,
            id: skillDialog.id,
            project: skillDialog.project
          };
          setSkillError("");
          setSkillNonce("pending");
          const request = {
            op: editOp,
            scope: skillDialog.scope,
            id: skillDialog.id,
            project: skillDialog.project,
            name: skillDraft.name ?? "",
            prevName: skillDialog.prevName ?? "",
            description: skillDraft.description ?? "",
            body: skillDraft.body ?? "",
            nonce: ""
          };
          void sendSkillWrite(request).then((result) => {
            setSkillNonce("");
            if (result.ok === true) {
              applyOptimisticSkillWrite(sent);
              setSkillDialog(null);
              setSkillError("");
              bumpRefresh();
              return;
            }
            setSkillError(String(result.reason ?? "\u5199\u5165\u5931\u8D25"));
          });
        }
      });
      const skillPreviewDialogView = skillPreviewDialog({
        skill: skillPreview,
        body: previewBody,
        pending: previewPending,
        primitives,
        onClose: () => {
          setSkillPreview(null);
          setPreviewPending(false);
          setPreviewNonce("");
        }
      });
      const confirmDeleteDialog = deleteConfirmDialog({
        dialog: deleteDialog,
        primitives,
        pending: deletePending,
        error: deleteError,
        onCancel: () => {
          setDeleteDialog(null);
          setDeletePending(false);
          setDeleteError("");
          setDeleteNonce("");
        },
        onConfirm: () => {
          if (deleteDialog?.closeOnConfirm === true) {
            setDeleteDialog(null);
            setDeletePending(false);
            setDeleteError("");
            setDeleteNonce("");
          }
          const run = deleteDialog?.run;
          if (typeof run === "function") run();
        }
      });
      const deletedIds = new Set(
        Object.entries(inflight).filter(([, info]) => info?.kind === "delete").map(([entryId]) => String(entryId).replace(/^include:/, ""))
      );
      const mcpRows = profileRows.filter((row) => !deletedIds.has(String(row.entryId).replace(/^include:/, ""))).filter(matches);
      const pendingByScope = /* @__PURE__ */ new Map();
      for (const [entryId, info] of pendingAdds2) {
        const scope = scopeKey(info?.scope);
        pendingByScope.set(scope, [...pendingByScope.get(scope) ?? [], entryId]);
      }
      const optimisticCard = (entryId) => {
        const info = inflight[entryId];
        const draftRow = info?.draft;
        if (draftRow === void 0) {
          return /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key: `pending:${entryId}` }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardHead", key: "head" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-pending", key: "p" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-spinner", key: "s" }), `\u6B63\u5728\u5199\u5165\u914D\u7F6E\u6587\u4EF6\u2026\uFF08${String(entryId).replace(/^include:mcp-/, "")}\uFF09`)));
        }
        const scope = scopeKey(info?.scope);
        const stdio = (draftRow.transport ?? "streamable-http") === "stdio";
        return profileCard({
          entryId: String(entryId),
          serverName: draftRow.serverName ?? "",
          scope: scope === "" ? "" : scope,
          transport: draftRow.transport ?? "streamable-http",
          target: stdio ? [draftRow.command, draftRow.args].filter((part) => String(part ?? "").trim() !== "").join(" ") : draftRow.url ?? "",
          command: draftRow.command ?? "",
          args: draftRow.args ?? "",
          env: draftRow.env ?? "",
          headersText: draftRow.headers ?? "",
          enabled: true,
          phase: ""
        }, scope === "" ? "global" : "project");
      };
      const mcpGroups = orderedScopeGroups(
        mcpRows,
        workspacePaths,
        // A scope whose only member is still being written must still get a group, or its
        // card would have nowhere to sit.
        [...pendingByScope.keys()]
      );
      const mcpList = /* @__PURE__ */ __dshReact.createElement("ul", { className: "smp-cards", key: "cards" }, mcpGroups.map((group) => [
        // `.map(profileCard)` would pass the array **index** as the `tier` argument —
        // which silently made every global card report its status against tier `0`, so
        // the tags vanished. Wrap the call.
        ...group.items.map((row) => profileCard(row, (row.scope ?? "global") === "global" ? "global" : "project")),
        ...(pendingByScope.get(group.scope) ?? []).map(optimisticCard)
      ]), mcpRows.length === 0 && pendingAdds2.length === 0 ? /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-empty", key: "empty", style: { gridColumn: "1 / -1" } }, emptyMcpText("")) : null);
      const mcpSummary = `\u5171 ${mcpRows.length} \u4E2A \xB7 \u4F5C\u7528\u57DF\u89C1\u5361\u7247\u4E0A\u7684\u5DE5\u4F5C\u533A\u6807\u7B7E \xB7 \u589E\u5220\u6539\u90FD\u4F1A\u5199\u56DE cordis.patch.yml\uFF08\u81EA\u52A8\u5907\u4EFD\uFF09`;
      const mcpSections = [
        /* @__PURE__ */ __dshReact.createElement("ul", { className: "smp-cards", key: "import" }, importCard(importScope)),
        // The form sits directly above the list it appends to — not at the bottom of it.
        // The trigger is on the search row; the form must not be a whole page away from it.
        editing?.kind === "mcp" && editing.id === void 0 ? /* @__PURE__ */ __dshReact.createElement("ul", { className: "smp-cards", key: "formWrap" }, serverForm({ tier: editing.tier })) : null,
        // No heading and no wrapper: the summary line above the search box already says
        // what the list is, and a section around a single list only added spacing of its
        // own. As a plain sibling of the import card, this list inherits the page rhythm.
        mcpList
      ];
      const skillsSummary = [
        `\u5171 ${skillGroups.reduce((total, group) => total + group.items.length, 0)} \u4E2A`,
        "\u4F5C\u7528\u57DF\u89C1\u5361\u7247\u4E0A\u7684\u6807\u7B7E",
        // Both scopes have two roots each; name them so the summary is not the half of it that
        // happens to be the default.
        `\u5168\u5C40\u5199 ${skillDirs.userDsh || "~/.dsh/skills"} \u6216 ${skillDirs.userAgents || "~/.agents/skills"}\uFF0C\u9879\u76EE\u7EA7\u5199 <\u5DE5\u4F5C\u533A>/.dsh/skills \u6216 <\u5DE5\u4F5C\u533A>/.agents/skills`
      ].join(" \xB7 ");
      const skillsSections = [skillsList];
      return /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-page" }, /* @__PURE__ */ __dshReact.createElement("style", { key: "css" }, CSS), head, tabs, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-groupSub smp-summaryAbove", key: "summary" }, tab === "mcp" ? mcpSummary : skillsSummary), filterRowView, statusOf(form) === "loading" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-empty", key: "loading" }, "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026") : null, error && !editing ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-error", key: "err" }, error) : null, skillError !== "" && skillDialog === null ? /* @__PURE__ */ __dshReact.createElement("p", { className: "smp-error", key: "skillerr" }, skillError) : null, confirmDeleteDialog, skillPreviewDialogView, skillDialogElement, tab === "mcp" ? mcpSections : skillsSections, debugOn ? /* @__PURE__ */ __dshReact.createElement("section", { className: "smp-group", key: "debug" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-groupTitleRow", key: "h" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-groupTitle" }, `Loader \u8BCA\u65AD\uFF1A\u5171 ${inventoryRows.length} \u884C\uFF0C\u5176\u4E2D mcp \u76F8\u5173 ${debugMcp.length} \u884C`)), /* @__PURE__ */ __dshReact.createElement("ul", { className: "smp-cards", key: "list" }, debugMcp.map((row) => /* @__PURE__ */ __dshReact.createElement("li", { className: "smp-card", key: row.entryId }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardContent", key: "c", style: { cursor: "default" } }, /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardMainRow", key: "r" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardIdentity", key: "i" }, row.entryId), /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-cardEnd", key: "e" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "smp-tag", "data-tone": "neutral" }, `${row.enabled ? "on" : "off"}${row.fiberPhase ? ` \xB7 ${row.fiberPhase}` : ""}`))), /* @__PURE__ */ __dshReact.createElement("div", { className: "smp-cardDescription", key: "d" }, row.moduleName)))))) : null);
    }
    return {
      inject: ["slots", "configForms", "remote", "remote.pluginInventory"],
      apply(ctx) {
        const form = ctx.configForms.get(NAME);
        let inventory;
        try {
          inventory = ctx.remote?.pluginInventory;
        } catch {
          inventory = void 0;
        }
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "skills-mcp",
          order: 20,
          label: () => "Skills & MCP",
          inject: () => ({ form, inventory })
        }, Panel));
      }
    };
  }
});
