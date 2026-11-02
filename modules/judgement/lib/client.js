window.__ModuleLoader__.load({ id: "dsh-judgment", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// client/react.js
var import_react = __toESM(require("react"), 1);
globalThis.__dshReact = import_react.default;

// client/config.js
var ENTRY_CANDIDATES = ["judgment/provider", "dsh-judgment"];
function findForm(ctx) {
  for (const entryId of ENTRY_CANDIDATES) {
    try {
      const form = ctx?.configForms?.get?.(entryId);
      if (form) return { form, entryId };
    } catch {
    }
  }
  return { form: void 0, entryId: ENTRY_CANDIDATES[0] };
}
function snapshotOf(form) {
  const snapshot = form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot;
  return snapshot?.value ?? snapshot ?? {};
}
function statusOf(form) {
  const snapshot = form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot;
  return snapshot?.status ?? "ready";
}
function dictOf(value, field) {
  const dict = value?.[field];
  return dict !== null && typeof dict === "object" && !Array.isArray(dict) ? dict : {};
}
var BASE_URL_PATTERN = /^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/;
var NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
var PROTOCOLS = [
  ["system-one", "system-one \u2014\u2014 TypeSafe\uFF08\u534F\u8BAE\u91CC\u53EB noul\uFF09"],
  ["openai-decisions", "openai-decisions \u2014\u2014 Luna\uFF08\u534F\u8BAE\u91CC\u53EB predicate\uFF09"]
];
var CREDENTIAL_PREFIX = "JUDGMENT_API_KEY_";
function nextCredentialRef(usedRefs = []) {
  const used = new Set(usedRefs.map((ref) => String(ref ?? "")));
  let index = 1;
  while (used.has(`${CREDENTIAL_PREFIX}${index}`)) index += 1;
  return `${CREDENTIAL_PREFIX}${index}`;
}
function resolveCredentialRef(previousRef, usedRefs = []) {
  const existing = String(previousRef ?? "").trim();
  return existing !== "" ? existing : nextCredentialRef(usedRefs);
}
function blankConnection() {
  return {
    name: "",
    protocol: "system-one",
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    model: "typesafe/jev-1.13",
    timeoutMs: 1e4,
    /** 密码框里的密钥值：只在这次编辑里存在，写进凭据服务后立刻丢弃。 */
    key: ""
  };
}
function connectionDraft(name, entry) {
  return {
    name,
    protocol: entry?.protocol ?? "system-one",
    baseUrl: entry?.baseUrl ?? "",
    model: entry?.model ?? "",
    timeoutMs: entry?.timeoutMs ?? 1e4,
    key: ""
  };
}
function blankPurpose() {
  return { name: "", connection: "" };
}
function validateKey(value) {
  const key = String(value ?? "").trim();
  if (key === "") return "\u5BC6\u94A5\u4E0D\u80FD\u4E3A\u7A7A\uFF08\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\uFF09";
  if (!/^[\x21-\x7E]+$/.test(key)) return "\u5BC6\u94A5\u53EA\u80FD\u5305\u542B\u53EF\u6253\u5370 ASCII \u5B57\u7B26\uFF08\u4E0D\u542B\u7A7A\u683C\u4E0E\u6362\u884C\uFF09";
  return null;
}
function validateConnection(draft) {
  const name = String(draft.name ?? "").trim();
  if (!NAME_PATTERN.test(name)) {
    return "\u8FDE\u63A5\u540D\u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u548C . - _\uFF0C\u4E14\u4E0D\u8D85\u8FC7 64 \u4E2A\u5B57\u7B26";
  }
  if (!/[A-Za-z0-9]/.test(name)) {
    return "\u8FDE\u63A5\u540D\u91CC\u81F3\u5C11\u8981\u6709\u4E00\u4E2A\u5B57\u6BCD\u6216\u6570\u5B57";
  }
  if (!BASE_URL_PATTERN.test(String(draft.baseUrl ?? "").trim())) {
    return "\u5730\u5740\u5FC5\u987B\u662F http(s) \u4E14\u4E0D\u542B\u51ED\u636E\u3001\u67E5\u8BE2\u4E32\u6216 # \u7247\u6BB5\uFF08\u7559\u7A7A\u8868\u793A\u5C1A\u672A\u914D\u7F6E\uFF09";
  }
  if (String(draft.model ?? "").trim() === "" || /\s/.test(String(draft.model))) {
    return "\u6A21\u578B\u540D\u4E0D\u80FD\u4E3A\u7A7A\u3001\u4E0D\u80FD\u542B\u7A7A\u767D\u5B57\u7B26\uFF08\u8981 pin \u5230\u5177\u4F53\u7248\u672C\uFF0C\u522B\u7528 latest \u522B\u540D\uFF09";
  }
  const timeout = Number(draft.timeoutMs);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3e5) {
    return "\u8D85\u65F6\u5FC5\u987B\u662F 1\u2013300000 \u4E4B\u95F4\u7684\u6574\u6570\u6BEB\u79D2";
  }
  return null;
}
function validatePurpose(draft) {
  if (!NAME_PATTERN.test(String(draft.name ?? "").trim())) {
    return "\u7528\u9014\u540D\u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u548C . - _\uFF0C\u4E14\u4E0D\u8D85\u8FC7 64 \u4E2A\u5B57\u7B26\uFF08\u4F8B\u5982 mobile.action\uFF09";
  }
  return null;
}
function connectionValue(draft, credentialRef) {
  return {
    protocol: draft.protocol,
    baseUrl: String(draft.baseUrl ?? "").trim(),
    model: String(draft.model ?? "").trim(),
    credentialRef: String(credentialRef ?? "").trim(),
    timeoutMs: Number(draft.timeoutMs)
  };
}
function describeConnection(entry) {
  const baseUrl = String(entry?.baseUrl ?? "") || "\uFF08\u672A\u8BBE\u5730\u5740\uFF09";
  const model = String(entry?.model ?? "") || "\uFF08\u672A\u8BBE\u6A21\u578B\uFF09";
  return `${baseUrl} \xB7 ${model}`;
}
function withoutKey(dict, key) {
  const next = { ...dict };
  delete next[key];
  return next;
}
function matchesQuery(needles, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (needle === "") return true;
  return needles.some((value) => String(value ?? "").toLowerCase().includes(needle));
}
function shouldClearCredential(ref, keyState) {
  return String(ref ?? "") !== "" && keyState?.writable !== false;
}
function keyStateText(keyState) {
  if (keyState === void 0) return "\u8BFB\u53D6\u4E2D\u2026";
  if (keyState === null) return "\u8BFB\u4E0D\u5230\u72B6\u6001";
  if (keyState.configured !== true) return "\u672A\u914D\u7F6E";
  if (keyState.writable === false) return "\u7531\u73AF\u5883\u63D0\u4F9B\uFF08\u53EA\u8BFB\uFF09";
  return "\u5DF2\u914D\u7F6E";
}
function connectionStatus(entry, keyState, verification) {
  if (String(entry?.baseUrl ?? "") === "") return { tone: "warn", text: "\u672A\u8BBE\u5730\u5740" };
  if (String(entry?.model ?? "") === "") return { tone: "warn", text: "\u672A\u8BBE\u6A21\u578B" };
  if (String(entry?.credentialRef ?? "") === "") return { tone: "warn", text: "\u672A\u8BBE\u51ED\u636E\u540D" };
  if (verification?.ok === false) return { tone: "warn", text: `\u81EA\u68C0\u5931\u8D25\uFF1A${verification.message ?? "\u539F\u56E0\u672A\u77E5"}` };
  if (verification?.ok === true) {
    return {
      tone: "ok",
      text: verification.latencyMs === void 0 ? "\u5DF2\u9A8C\u8BC1" : `\u5DF2\u9A8C\u8BC1 \xB7 ${verification.latencyMs}ms`
    };
  }
  if (keyState === void 0) return { tone: "neutral", text: "\u914D\u7F6E\u5B8C\u6574 \xB7 \u672A\u81EA\u68C0" };
  if (keyState === null) return { tone: "warn", text: "\u8BFB\u4E0D\u5230\u5BC6\u94A5\u72B6\u6001" };
  if (keyState.writable === false && keyState.configured === true) return { tone: "ok", text: "\u5BC6\u94A5\u7531\u73AF\u5883\u63D0\u4F9B \xB7 \u672A\u81EA\u68C0" };
  if (keyState.configured === true) return { tone: "ok", text: "\u5BC6\u94A5\u5DF2\u914D\u7F6E \xB7 \u672A\u81EA\u68C0" };
  return { tone: "warn", text: "\u5BC6\u94A5\u672A\u914D\u7F6E" };
}
function keyFieldState(keyState) {
  if (keyState === void 0) {
    return { locked: false, placeholder: "\u586B\u5165 API key\uFF08\u4FDD\u5B58\u540E\u4E0D\u56DE\u663E\uFF09", hint: "\u6B63\u5728\u8BFB\u53D6\u5BC6\u94A5\u72B6\u6001\u2026" };
  }
  if (keyState === null) {
    return { locked: true, placeholder: "\u5BBF\u4E3B\u672A\u63D0\u4F9B\u51ED\u636E\u9762", hint: "\u8FD9\u4E2A profile \u91CC\u6CA1\u6709\u51ED\u636E\u670D\u52A1\uFF0C\u65E0\u6CD5\u5728\u8FD9\u91CC\u5199\u5165\u5BC6\u94A5" };
  }
  if (keyState.writable === false) {
    return {
      locked: true,
      placeholder: "\u7531\u542F\u52A8\u73AF\u5883\u63D0\u4F9B\uFF08\u53EA\u8BFB\uFF09",
      hint: `\u5DF2\u7531\u73AF\u5883\u53D8\u91CF\u63D0\u4F9B${keyState.source ? `\uFF08${keyState.source}\uFF09` : ""}\uFF0C\u8FD9\u91CC\u4E0D\u80FD\u4FEE\u6539`
    };
  }
  if (keyState.configured === true) {
    return {
      locked: false,
      placeholder: "\u5DF2\u914D\u7F6E \xB7 \u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539",
      hint: `\u5DF2\u914D\u7F6E${keyState.source ? ` \xB7 \u6765\u6E90 ${keyState.source}` : ""}\uFF1B\u7559\u7A7A\u5373\u4FDD\u6301\u539F\u503C`
    };
  }
  return { locked: false, placeholder: "\u586B\u5165 API key\uFF08\u4FDD\u5B58\u540E\u4E0D\u56DE\u663E\uFF09", hint: "\u5C1A\u672A\u914D\u7F6E" };
}
function purposeStatus(purpose, connections, defaultConnection) {
  const target = String(purpose?.connection ?? "");
  const resolved = target !== "" ? target : String(defaultConnection ?? "");
  if (resolved === "") return { tone: "warn", text: "\u672A\u6307\u5411\u8FDE\u63A5" };
  if (connections?.[resolved] === void 0) return { tone: "danger", text: "\u8FDE\u63A5\u4E0D\u5B58\u5728" };
  return { tone: "ok", text: target === "" ? "\u8DDF\u968F\u9ED8\u8BA4\u8FDE\u63A5" : "\u6307\u5411\u5DF2\u914D\u7F6E\u8FDE\u63A5" };
}
function purposeTargetLabel(purpose, defaultConnection) {
  const target = String(purpose?.connection ?? "");
  if (target !== "") return target;
  return String(defaultConnection ?? "") === "" ? "\u65E0\u8FDE\u63A5" : "\u9ED8\u8BA4";
}
function purposesUsing(purposes, connectionId, defaultConnection) {
  return Object.entries(purposes).filter(([, purpose]) => (purpose?.connection ?? "") === connectionId).map(([name]) => name).concat(defaultConnection === connectionId ? ["\uFF08\u9ED8\u8BA4\u8FDE\u63A5\uFF09"] : []);
}

// client/judgment-remote.js
var PACKAGE = "dsh-judgment";
var SERVICE = "judgment";
function codec(typeSymbol) {
  return { mode: "strict", typeSymbol, create: () => ({ parse: (value) => value }) };
}
function descriptor(method, parameters) {
  const endpoint = `${SERVICE}/${method}`;
  return {
    id: `${PACKAGE}#${endpoint}`,
    service: SERVICE,
    namespace: SERVICE,
    method,
    invocation: { kind: "direct" },
    parameters: parameters.map((name) => ({
      name,
      wire: name,
      source: "json",
      codec: codec(`${PACKAGE}#${endpoint}:${name}`)
    })),
    // 结果原样透传（`JudgeStatus` / `JudgeHealth` 全是 JSON 值）；strip 由 host 侧负责。
    result: { mode: "src-json" }
  };
}
function judgmentContribution() {
  return {
    package: PACKAGE,
    descriptors: [
      // host: status()  —— 页面刷新后仍能显示「已验证」
      descriptor("status", []),
      // host: health(options) —— wire 名必须等于形参名 `options`
      descriptor("health", ["options"])
    ]
  };
}

// client/primitives.js
var primitives = (() => {
  try {
    return require("@deepseek-ai/dsh-client-ui-primitives");
  } catch {
    return null;
  }
})();

// client/panel.jsx
var import_react6 = require("react");

// client/components.jsx
var import_react3 = require("react");
function Field({ label, hint, wide, children }) {
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-field", "data-wide": wide === true ? "true" : void 0 }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-label" }, label), children, hint ? /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-hint" }, hint) : null);
}
function MoreMenu({ items, disabled }) {
  const [open, setOpen] = (0, import_react3.useState)(false);
  return /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-more" }, /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      className: "jdg-moreTrigger",
      disabled: disabled === true,
      "aria-haspopup": "menu",
      "aria-expanded": open,
      "aria-label": "\u66F4\u591A\u64CD\u4F5C",
      onClick: () => setOpen((current) => !current)
    },
    "\u22EF"
  ), open ? /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-menuScrim", onClick: () => setOpen(false) }), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-menu", role: "menu" }, items.map(([label, run, variant, itemDisabled]) => /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      key: label,
      role: "menuitem",
      className: "jdg-menuItem",
      "data-variant": variant,
      disabled: itemDisabled === true,
      onClick: () => {
        setOpen(false);
        if (itemDisabled === true) return;
        run();
      }
    },
    label
  )))) : null);
}
function Tag({ children, tone = "neutral" }) {
  return /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-tag", "data-tone": tone }, children);
}
function Chevron({ open }) {
  return /* @__PURE__ */ __dshReact.createElement(
    "svg",
    {
      className: "jdg-chevron",
      "data-open": String(open),
      width: 16,
      height: 16,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true"
    },
    /* @__PURE__ */ __dshReact.createElement("path", { d: "M4 6l4 4 4-4", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })
  );
}
function Status({ tone, text }) {
  return /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-status" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-dot", "data-dot": tone, "aria-hidden": "true" }), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-statusText" }, text));
}
function SearchIcon() {
  return /* @__PURE__ */ __dshReact.createElement("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ __dshReact.createElement("circle", { cx: "7", cy: "7", r: "4.2", stroke: "currentColor", strokeWidth: "1.4" }), /* @__PURE__ */ __dshReact.createElement("path", { d: "M10.2 10.2 13.5 13.5", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }));
}

// client/dialog.jsx
function ConfirmDialog({ dialog, primitives: primitives2, onCancel, onConfirm, pending = false, error = "" }) {
  if (dialog === null || dialog === void 0) return null;
  const Modal = primitives2?.Modal;
  if (Modal === void 0) return null;
  const Button = primitives2.Button ?? "button";
  return /* @__PURE__ */ __dshReact.createElement(
    Modal,
    {
      open: true,
      onClose: onCancel,
      title: `\u5220\u9664${dialog.kind === "connection" ? "\u8FDE\u63A5" : "\u7528\u9014"}\u300C${dialog.label}\u300D\uFF1F`,
      closeLabel: "\u5173\u95ED",
      description: /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-deleteMeta" }, /* @__PURE__ */ __dshReact.createElement("div", null, dialog.note), error !== "" ? /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-error", style: { marginTop: 6 } }, error) : null, pending ? /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-pendingHint" }, "\u6B63\u5728\u5220\u9664\u5E76\u5237\u65B0\u914D\u7F6E\u2026") : null),
      footer: /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement(Button, { variant: "outline", key: "cancel", onClick: onCancel, disabled: pending }, "\u53D6\u6D88"), /* @__PURE__ */ __dshReact.createElement(Button, { variant: "primary", key: "ok", onClick: onConfirm, disabled: pending }, pending ? "\u5220\u9664\u4E2D\u2026" : "\u5220\u9664"))
    }
  );
}

// client/styles.css
var styles_default = `/*
 * \u51B3\u7B56\u914D\u7F6E\u9875\u6837\u5F0F\u3002\u7C7B\u540D\u4E00\u5F8B jdg- \u524D\u7F00\uFF1A\u6837\u5F0F\u662F\u9875\u9762\u6302\u8F7D\u65F6\u5168\u5C40\u6CE8\u5165\u7684\uFF0C
 * \u800C skills-mcp \u9762\u677F\u7528\u7684\u662F smp- \u524D\u7F00\uFF0C\u4E24\u5957\u9875\u9762\u53EF\u80FD\u540C\u65F6\u6302\u8F7D\uFF08\u8BBE\u7F6E\u9875\u7B7E\u4F1A\u4FDD\u6D3B\uFF09\uFF0C
 * \u6240\u4EE5\u4E0D\u80FD\u5171\u7528\u7C7B\u540D\u3002\u89C6\u89C9\u5BF9\u9F50\u90A3\u5957\u9762\u677F\uFF08\u5361\u7247 + \u53EF\u5C55\u5F00\u884C + \u641C\u7D22\u884C + \u300C\u2026\u300D\u83DC\u5355\uFF09\uFF0C
 * \u5168\u90E8\u8D70\u4E3B\u9898\u53D8\u91CF\uFF0C\u8DDF\u968F Harness \u7684\u660E\u6697\u4E0E\u914D\u8272\u3002
 */
.jdg-page{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:14px;display:flex}
.jdg-page>*{width:100%;max-width:960px}
.jdg-pageHead{box-sizing:border-box;justify-content:space-between;align-items:flex-start;gap:16px;display:flex}
.jdg-pageTitle{margin:0;font-size:18px;font-weight:500;line-height:26px}
.jdg-pageIntro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}
.jdg-summary{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}

/* \u641C\u7D22\u884C\uFF1A\u641C\u7D22\u6846 + \u4E3B\u64CD\u4F5C\u3002\u4E0E\u9762\u677F\u7684 filterRow \u540C\u5F62\u3002 */
.jdg-filterRow{display:flex;align-items:center;gap:8px}
.jdg-search{flex:1 1 auto;min-width:140px;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}
.jdg-searchIcon{position:absolute;left:12px;display:inline-flex;pointer-events:none}
.jdg-searchInput{box-sizing:border-box;width:100%;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:0 12px 0 36px}
.jdg-searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}
.jdg-searchInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}

/* \u9ED8\u8BA4\u8FDE\u63A5\uFF1A\u4E00\u884C\u6807\u7B7E + \u9009\u62E9\u5668\uFF08\u6807\u7B7E\u4E0D\u80FD\u88AB flex \u6324\u65AD\uFF09\u3002 */
.jdg-inlineRow{display:flex;align-items:center;gap:10px}
.jdg-inlineRow .jdg-label{flex:none;white-space:nowrap}
.jdg-inlineRow .jdg-select{flex:1 1 auto;min-width:0}

/* \u9875\u7B7E\u6761\uFF1A\u4E0E skills-mcp \u9762\u677F\u540C\u4E00\u5F62\u6001\uFF08\u4E0B\u8FB9\u6846 + \u9009\u4E2D\u9879 2px \u4E0B\u5212\u7EBF\uFF09\u3002 */
.jdg-tabs{display:flex;gap:24px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.jdg-tab{appearance:none;background:none;border:0;padding:0 2px 10px;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.jdg-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}
.jdg-tab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}

/* \u5361\u7247\uFF1A\u5DE6\u5217\u662F\u300C\u7BAD\u5934 + \u6807\u9898\u300D\uFF0C\u53F3\u5217\u662F\u72B6\u6001\u4E0E\u64CD\u4F5C\uFF1B\u5C55\u5F00\u4F53\u5728\u884C\u4E4B\u5916\u5360\u6EE1\u6574\u5BBD\u3002 */
.jdg-cards{flex-direction:column;gap:14px;margin:0;padding:0;list-style:none;display:flex}
.jdg-card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);flex-direction:column;gap:4px;padding:12px 14px;min-width:0;display:flex}
.jdg-cardRow{align-items:center;gap:10px;min-width:0;display:flex}
.jdg-cardToggle{box-sizing:border-box;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex:1 1 auto;align-items:center;gap:8px;min-width:0;padding:0;display:inline-flex}
.jdg-cardIdentity{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;min-width:0;overflow-wrap:anywhere}
.jdg-cardIdentity .jdg-tag{margin-left:6px}
.jdg-cardEnd{flex:none;align-items:center;gap:8px;display:inline-flex}
.jdg-cardActions{align-items:center;gap:4px;flex:none;display:inline-flex}
.jdg-probeLine{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.jdg-probeLine[data-tone=ok]{color:var(--dsw-alias-state-success-primary,#12805c)}
.jdg-probeLine[data-tone=warn]{color:var(--dsw-alias-state-error-primary,#d92d20)}
.jdg-cardDescription{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.jdg-cardDetails{border-top:.5px solid var(--dsw-alias-border-l2);padding:12px 0 0}
.jdg-card>.jdg-cardDetails:first-child{border-top:0;padding-top:0}

.jdg-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .14s ease-in-out}
.jdg-chevron[data-open=false]{transform:rotate(-90deg)}

/* \u72B6\u6001\uFF1A\u5706\u70B9\u627F\u62C5\u989C\u8272\u3001\u6587\u5B57\u627F\u62C5\u542B\u4E49\uFF1Bdanger \u4E00\u6863\u6587\u5B57\u4E5F\u8981\u8DDF\u4E0A\uFF08\u5B83\u662F\u771F\u8981\u7528\u6237\u52A8\u624B\u7684\u4E8B\uFF09\u3002 */
.jdg-status{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:16px;white-space:nowrap}
.jdg-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#9aa4b2)}
.jdg-dot[data-dot=ok]{background:var(--dsw-alias-state-success-primary,#067647)}
.jdg-dot[data-dot=warn]{background:var(--dsw-alias-state-warn-primary,#b54708)}
.jdg-dot[data-dot=danger]{background:var(--dsw-alias-state-error-primary,#d92d20)}
.jdg-dot[data-dot=neutral]{background:var(--dsw-alias-label-tertiary,#9aa4b2)}
.jdg-statusText{color:var(--dsw-alias-label-secondary)}
.jdg-status:has(.jdg-dot[data-dot=danger]) .jdg-statusText{color:var(--dsw-alias-state-error-primary,#d92d20)}
.jdg-status:has(.jdg-dot[data-dot=warn]) .jdg-statusText{color:var(--dsw-alias-state-warn-primary,#b54708)}

.jdg-details{grid-template-columns:76px minmax(0,1fr);gap:6px 10px;margin:0;display:grid;font-size:12px;line-height:18px}
.jdg-detailsKey{color:var(--dsw-alias-label-tertiary)}
.jdg-detailsValue{color:var(--dsw-alias-label-secondary);word-break:break-all}

.jdg-tag{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
.jdg-tag[data-tone=neutral]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.jdg-tag[data-tone=ok]{background:var(--dsw-alias-state-success-tertiary,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-state-success-primary,#067647)}

.jdg-formGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
.jdg-card>.jdg-formGrid:first-child{margin-top:0}
.jdg-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.jdg-field[data-wide=true]{grid-column:1 / -1}
.jdg-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.jdg-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.jdg-input,.jdg-select{box-sizing:border-box;width:100%;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:0 10px}
.jdg-input[readonly]{color:var(--dsw-alias-label-secondary)}
.jdg-select{appearance:none;-webkit-appearance:none;padding:0 30px 0 10px;background-color:var(--dsw-alias-bg-layer-1);background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6.5 8 10.5 12 6.5' stroke='%238b8f99' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:14px}
.jdg-input:focus-visible,.jdg-select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}

.jdg-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:32px;padding:0 14px;border:.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;flex:none}
.jdg-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.jdg-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.jdg-button[data-variant=outline]{border-color:var(--dsw-alias-border-l3)}
.jdg-button[data-variant=primary]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.jdg-button[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.jdg-button:disabled{opacity:.4;cursor:not-allowed}
.jdg-actionsRow{display:flex;align-items:center;gap:8px;margin-top:10px}

.jdg-more{position:relative;display:inline-flex;flex:none}
.jdg-moreTrigger{box-sizing:border-box;width:22px;height:22px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.jdg-moreTrigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.jdg-moreTrigger:disabled{opacity:.5;cursor:default}
.jdg-menuScrim{position:fixed;inset:0;z-index:40}
.jdg-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:41;min-width:104px;padding:4px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);box-shadow:0 6px 20px rgba(0,0,0,.12)}
.jdg-menuItem{box-sizing:border-box;width:100%;text-align:left;border:0;background:0 0;border-radius:var(--dsw-radius-sm);padding:6px 10px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.jdg-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.jdg-menuItem[data-variant=danger]{color:var(--dsw-alias-state-error-primary,#d92d20)}
.jdg-menuItem:disabled{opacity:.45;cursor:default}

.jdg-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px;list-style:none}
.jdg-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;list-style:none}
.jdg-note code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;background:var(--dsw-alias-bg-module-platform);border-radius:var(--dsw-radius-xs,4px);padding:0 4px}
.jdg-error{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-size:12px;line-height:18px;margin:0}
`;

// client/panel.jsx
var EMPTY = {};
function Panel(props) {
  const form = props.form;
  const [tick, setTick] = (0, import_react6.useState)(0);
  const [error, setError] = (0, import_react6.useState)("");
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [editor, setEditor] = (0, import_react6.useState)(props.initialEditor === "connection" || props.initialEditor === "purpose" ? { kind: props.initialEditor, isNew: true } : null);
  const [draft, setDraft] = (0, import_react6.useState)(props.initialEditor === "connection" ? blankConnection() : props.initialEditor === "purpose" ? blankPurpose() : EMPTY);
  const [expanded, setExpanded] = (0, import_react6.useState)(typeof props.initialExpanded === "string" ? props.initialExpanded : "");
  const [query, setQuery] = (0, import_react6.useState)("");
  const [tab, setTab] = (0, import_react6.useState)(props.initialTab === "purposes" ? "purposes" : "connections");
  const [keyStates, setKeyStates] = (0, import_react6.useState)({});
  const [probes, setProbes] = (0, import_react6.useState)({});
  const [verified, setVerified] = (0, import_react6.useState)({});
  const [confirm, setConfirm] = (0, import_react6.useState)(null);
  const [confirmPending, setConfirmPending] = (0, import_react6.useState)(false);
  const [confirmError, setConfirmError] = (0, import_react6.useState)("");
  (0, import_react6.useEffect)(() => {
    if (typeof form?.subscribe !== "function") return void 0;
    return form.subscribe(() => setTick((count) => count + 1));
  }, [form]);
  const value = snapshotOf(form);
  const status = statusOf(form);
  const connections = dictOf(value, "connections");
  const purposes = dictOf(value, "purposes");
  const defaultConnection = typeof value?.defaultConnection === "string" ? value.defaultConnection : "";
  const writable = typeof form?.set === "function" || typeof props.mutate === "function";
  const credentials = props.credentials;
  const keyRefs = [...new Set(Object.values(connections).map((entry) => String(entry?.credentialRef ?? "")).filter((ref) => ref !== ""))];
  const keyRefsKey = keyRefs.join("|");
  (0, import_react6.useEffect)(() => {
    if (credentials === void 0 || keyRefsKey === "") {
      setKeyStates({});
      return void 0;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await credentials.describe(keyRefsKey.split("|"));
        if (!alive) return;
        setKeyStates(response?.ok === true && response.value !== null && typeof response.value === "object" ? response.value : {});
      } catch {
        if (alive) setKeyStates({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [credentials, keyRefsKey]);
  const connectionIdsKey = Object.keys(connections).join("|");
  (0, import_react6.useEffect)(() => {
    if (props.judgment === void 0) return void 0;
    let alive = true;
    void (async () => {
      try {
        const envelope = await props.judgment.status();
        if (!alive || envelope?.ok !== true) return;
        const next = {};
        for (const entry of envelope.value?.connections ?? []) {
          if (entry?.verified === true) {
            next[entry.connection] = { ok: true, ...typeof entry.verifiedAt === "string" ? { at: entry.verifiedAt } : {} };
          }
        }
        setVerified(next);
      } catch {
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.judgment, connectionIdsKey]);
  async function refreshKeys(ref) {
    if (credentials === void 0 || ref === "") return;
    try {
      const response = await credentials.describe([ref]);
      if (response?.ok === true && response.value !== null && typeof response.value === "object") {
        setKeyStates((current) => ({ ...current, ...response.value }));
      }
    } catch {
    }
  }
  const excludeId = editor?.isNew === true ? void 0 : editor?.id;
  const otherRefs = Object.entries(connections).filter(([id]) => id !== excludeId).map(([, entry]) => String(entry?.credentialRef ?? ""));
  const draftPreviousRef = editor?.isNew === true ? "" : String(connections[editor?.id]?.credentialRef ?? "");
  const draftRef = resolveCredentialRef(draftPreviousRef, otherRefs);
  const draftKeyState = credentials === void 0 ? null : keyRefs.includes(draftRef) ? keyStates[draftRef] : { configured: false };
  const draftKeyField = keyFieldState(draftKeyState);
  const editingConnection = editor?.kind === "connection" && editor.isNew !== true ? editor.id : void 0;
  const editingPurpose = editor?.kind === "purpose" && editor.isNew !== true ? editor.id : void 0;
  const connectionIds = Object.keys(connections).filter((id) => id === editingConnection || matchesQuery([id, connections[id].protocol, connections[id].baseUrl, connections[id].model, connections[id].credentialRef], query));
  const purposeIds = Object.keys(purposes).filter((name) => name === editingPurpose || matchesQuery([name, purposeTargetLabel(purposes[name], defaultConnection)], query));
  async function commit(field, next) {
    setBusy(true);
    setError("");
    try {
      if (typeof form?.set === "function") await form.set(field, next);
      else if (typeof props.mutate === "function") await props.mutate(props.entryId, [{ op: "set", path: [field], value: next }]);
      else throw new Error("\u914D\u7F6E\u8868\u5355\u4E0D\u53EF\u5199\uFF1A\u5BBF\u4E3B\u65E2\u6CA1\u6709 set \u4E5F\u6CA1\u6709 mutate");
      setTick((count) => count + 1);
      return true;
    } catch (cause) {
      setError(String(cause?.message ?? cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function closeEditor() {
    setEditor(null);
    setDraft(EMPTY);
  }
  function openCreate(kind) {
    setError("");
    setEditor({ kind, isNew: true });
    setDraft(kind === "connection" ? blankConnection() : blankPurpose());
  }
  function openEdit(kind, id) {
    setError("");
    setEditor({ kind, id, isNew: false });
    setDraft(kind === "connection" ? connectionDraft(id, connections[id]) : { name: id, connection: purposes[id]?.connection ?? "" });
  }
  async function saveConnection() {
    const message = validateConnection(draft);
    if (message !== null) {
      setError(message);
      return;
    }
    const key = String(draft.key ?? "").trim();
    if (key !== "") {
      const invalid = validateKey(key);
      if (invalid !== null) {
        setError(invalid);
        return;
      }
    }
    const name = String(draft.name).trim();
    if (editor?.isNew === true && connections[name] !== void 0) {
      setError(`\u8FDE\u63A5 "${name}" \u5DF2\u7ECF\u5B58\u5728`);
      return;
    }
    const previousRef = editor?.isNew === true ? "" : String(connections[name]?.credentialRef ?? "");
    const entry = connectionValue(draft, resolveCredentialRef(previousRef, otherRefs));
    if (!await commit("connections", { ...connections, [name]: entry })) return;
    if (credentials === void 0 || key === "") {
      closeEditor();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await credentials.set(entry.credentialRef, key);
      if (response?.ok !== true) {
        setError(`\u5BC6\u94A5\u672A\u5199\u5165\uFF1A${response?.error?.message ?? "\u672A\u77E5\u539F\u56E0"}`);
        return;
      }
    } catch (cause) {
      setError(`\u5BC6\u94A5\u672A\u5199\u5165\uFF1A${String(cause?.message ?? cause)}`);
      return;
    } finally {
      setBusy(false);
    }
    await refreshKeys(entry.credentialRef);
    closeEditor();
  }
  async function savePurpose() {
    const message = validatePurpose(draft);
    if (message !== null) {
      setError(message);
      return;
    }
    const name = String(draft.name).trim();
    if (editor?.isNew === true && purposes[name] !== void 0) {
      setError(`\u7528\u9014 "${name}" \u5DF2\u7ECF\u5B58\u5728`);
      return;
    }
    if (await commit("purposes", { ...purposes, [name]: { connection: String(draft.connection ?? "") } })) closeEditor();
  }
  function askRemove(kind, label, note, run) {
    if (props.primitives?.Modal === void 0) {
      const verb = kind === "connection" ? "\u8FDE\u63A5" : "\u7528\u9014";
      if (typeof window !== "undefined" && !window.confirm(`\u5220\u9664${verb}\u300C${label}\u300D\uFF1F

${note}`)) return;
      void run().catch((cause) => setError(String(cause?.message ?? cause)));
      return;
    }
    setConfirmError("");
    setConfirm({ kind, label, note, run });
  }
  async function confirmRemove() {
    if (confirm === null) return;
    setConfirmPending(true);
    setConfirmError("");
    try {
      await confirm.run();
      setConfirm(null);
    } catch (cause) {
      setConfirmError(String(cause?.message ?? cause));
    } finally {
      setConfirmPending(false);
    }
  }
  async function deleteConnection(id, ref) {
    if (credentials !== void 0 && shouldClearCredential(ref, keyStates[ref])) {
      const response = await credentials.unset(ref);
      if (response?.ok !== true) throw new Error(`\u5BC6\u94A5\u672A\u6E05\u9664\uFF0C\u5DF2\u53D6\u6D88\u5220\u9664\uFF1A${response?.error?.message ?? "\u672A\u77E5\u539F\u56E0"}`);
    }
    const clearingDefault = defaultConnection === id;
    if (!await commit("connections", withoutKey(connections, id))) throw new Error("\u914D\u7F6E\u672A\u5199\u5165");
    if (clearingDefault) await commit("defaultConnection", "");
    closeEditor();
  }
  async function deletePurpose(name) {
    if (!await commit("purposes", withoutKey(purposes, name))) throw new Error("\u914D\u7F6E\u672A\u5199\u5165");
    closeEditor();
  }
  function removeConnection(id) {
    const affected = purposesUsing(purposes, id, defaultConnection);
    const ref = String(connections[id]?.credentialRef ?? "");
    const note = [
      affected.length === 0 ? "" : `\u6709 ${affected.length} \u5904\u6307\u5411\u5B83\uFF08${affected.join("\u3001")}\uFF09\uFF0C\u5220\u9664\u540E\u90A3\u4E9B\u7528\u9014\u4F1A\u5931\u6548\u3002`,
      ref === "" ? "\u8FD9\u4E2A\u8FDE\u63A5\u8FD8\u6CA1\u6709\u5BC6\u94A5\u3002" : `\u5B83\u7684\u5BC6\u94A5\uFF08${ref}\uFF09\u4F1A\u4E00\u5E76\u6E05\u9664\u2014\u2014\u5E8F\u53F7\u4F1A\u88AB\u56DE\u6536\uFF0C\u7559\u7740\u4F1A\u8BA9\u4E0B\u4E00\u6761\u8FDE\u63A5\u8BFB\u5230\u8FD9\u628A\u9057\u7559\u7684 key\u3002`
    ].join(" ");
    askRemove("connection", id, note, () => deleteConnection(id, ref));
  }
  function removePurpose(name) {
    askRemove("purpose", name, "\u5220\u9664\u540E\uFF0C\u6D88\u8D39\u8005\u518D\u62A5\u8FD9\u4E2A\u7528\u9014\u540D\u4F1A\u76F4\u63A5\u62A5\u9519\uFF08\u4E0D\u4F1A\u9759\u9ED8\u6362\u8FDE\u63A5\uFF09\u3002", () => deletePurpose(name));
  }
  function toggle(key) {
    setExpanded((current) => current === key ? "" : key);
  }
  function selectTab(next) {
    if (next === tab) return;
    setTab(next);
    setExpanded("");
    setEditor(null);
    setDraft(EMPTY);
    setQuery("");
    setError("");
  }
  function verificationOf(id) {
    const probed = probes[id];
    if (probed === void 0) return verified[id];
    if (probed.busy === true) return void 0;
    return probed;
  }
  function probeLine(id) {
    const probe = probes[id];
    if (probe?.busy === true) return { tone: "neutral", text: "\u6B63\u5728\u81EA\u68C0\u2026\uFF08\u5411\u8FD9\u4E2A\u7AEF\u70B9\u53D1\u4E00\u6B21\u6700\u5C0F\u8BF7\u6C42\uFF09" };
    const state = verificationOf(id);
    if (state?.ok === false) {
      const hint = /404|transport failure/.test(state.message ?? "") ? "\uFF08host \u534A\u53EF\u80FD\u662F\u65E7\u7248\u672C\uFF1A\u63D2\u4EF6\u66F4\u65B0\u540E\u9700\u91CD\u542F DSH\uFF09" : "";
      return { tone: "warn", text: `\u81EA\u68C0\u5931\u8D25 \xB7 ${state.message ?? "\u539F\u56E0\u672A\u77E5"}${hint}` };
    }
    if (state?.ok === true) {
      if (probe?.ok === true) {
        return { tone: "ok", text: `\u81EA\u68C0\u901A\u8FC7 \xB7 ${probe.latencyMs ?? "\u2014"}ms \xB7 \u6A21\u578B\u5FEB\u7167 ${probe.model ?? "\u2014"}` };
      }
      const at = typeof state.at === "string" ? new Date(state.at) : void 0;
      const when = at === void 0 || Number.isNaN(at.getTime()) ? "" : ` \xB7 \u4E0A\u6B21 ${at.toLocaleTimeString()}`;
      return { tone: "ok", text: `\u5DF2\u9A8C\u8BC1${when}` };
    }
    if (props.judgment === void 0) return { tone: "neutral", text: "\u5BBF\u4E3B\u672A\u63D0\u4F9B\u81EA\u68C0\u901A\u8DEF\uFF1A\u53EA\u80FD\u770B\u5230\u672C\u5730\u300C\u5DF2\u914D\u7F6E\u300D\uFF0C\u65E0\u6CD5\u786E\u8BA4\u8FDC\u7AEF\u53EF\u7528" };
    return { tone: "neutral", text: "\u5C1A\u672A\u81EA\u68C0 \xB7 \u53EF\u5728 \u22EF \u83DC\u5355\u91CC\u81EA\u68C0\uFF08\u4F1A\u771F\u53D1\u4E00\u6B21\u8BF7\u6C42\uFF09" };
  }
  async function runProbe(id) {
    if (props.judgment === void 0) return;
    setProbes((current) => ({ ...current, [id]: { busy: true } }));
    try {
      const envelope = await props.judgment.health({ connection: id });
      if (envelope?.ok === true) {
        const value2 = envelope.value ?? {};
        setProbes((current) => ({
          ...current,
          [id]: {
            ok: true,
            ...typeof value2.latencyMs === "number" ? { latencyMs: value2.latencyMs } : {},
            ...typeof value2.model === "string" ? { model: value2.model } : {},
            ...typeof value2.checkedAt === "string" ? { at: value2.checkedAt } : {}
          }
        }));
        return;
      }
      const failure = envelope?.error;
      const detail = failure === void 0 ? "\u5BBF\u4E3B\u8FD4\u56DE\u4E86\u5931\u8D25\u4F46\u6CA1\u6709\u539F\u56E0" : `${failure.code ?? "error"} \xB7 ${failure.message ?? ""}`.trim();
      setProbes((current) => ({ ...current, [id]: { ok: false, message: detail } }));
    } catch (cause) {
      setProbes((current) => ({ ...current, [id]: { ok: false, message: String(cause?.message ?? cause) } }));
    }
  }
  function connectionCard(id) {
    const entry = connections[id] ?? {};
    const key = `connection:${id}`;
    const open = expanded === key;
    const ref = String(entry.credentialRef ?? "");
    const probe = probes[id];
    const probeState = probeLine(id);
    const state = connectionStatus(entry, ref === "" ? null : keyStates[ref], verificationOf(id));
    return /* @__PURE__ */ __dshReact.createElement("li", { className: "jdg-card", key }, /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-cardRow" }, /* @__PURE__ */ __dshReact.createElement(
      "button",
      {
        type: "button",
        className: "jdg-cardToggle",
        "aria-expanded": open,
        onClick: () => toggle(key)
      },
      /* @__PURE__ */ __dshReact.createElement(Chevron, { open }),
      /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-cardIdentity" }, id, /* @__PURE__ */ __dshReact.createElement(Tag, null, entry.protocol))
    ), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-cardEnd" }, /* @__PURE__ */ __dshReact.createElement(Status, { tone: state.tone, text: state.text })), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-cardActions" }, /* @__PURE__ */ __dshReact.createElement(
      MoreMenu,
      {
        disabled: busy,
        items: [
          ["\u81EA\u68C0", () => {
            void runProbe(id);
          }, void 0, props.judgment === void 0 || probe?.busy === true],
          ["\u7F16\u8F91", () => openEdit("connection", id), void 0, !writable],
          ["\u5220\u9664", () => {
            void removeConnection(id);
          }, "danger", !writable]
        ]
      }
    ))), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-probeLine", "data-tone": probeState.tone }, probeState.text), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-cardDescription" }, describeConnection(entry)), open ? /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-cardDetails" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-details" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u5730\u5740"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, entry.baseUrl || "\u2014"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u6A21\u578B"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, entry.model || "\u2014"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u51ED\u636E\u540D"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, ref || "\u2014\uFF08\u6309\u8FDE\u63A5\u540D\u6D3E\u751F\uFF09"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u5BC6\u94A5"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, keyStateText(ref === "" ? null : keyStates[ref])), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u8D85\u65F6"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, `${entry.timeoutMs ?? "\u2014"} ms`), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u88AB\u5F15\u7528"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, `${purposesUsing(purposes, id, "").length} \u4E2A\u7528\u9014`))) : null);
  }
  function connectionForm() {
    return /* @__PURE__ */ __dshReact.createElement("li", { className: "jdg-card", key: "connection:form" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-formGrid" }, /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u8FDE\u63A5\u540D", hint: "\u6D88\u8D39\u8005\u770B\u4E0D\u5230\u5B83\uFF1B\u7528\u9014\u6307\u5411\u5B83" }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "jdg-input",
        value: draft.name ?? "",
        readOnly: editor?.isNew !== true,
        placeholder: "typesafe-main",
        onChange: (event) => setDraft({ ...draft, name: event.target.value })
      }
    )), /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u534F\u8BAE" }, /* @__PURE__ */ __dshReact.createElement(
      "select",
      {
        className: "jdg-select",
        value: draft.protocol ?? "system-one",
        onChange: (event) => setDraft({ ...draft, protocol: event.target.value })
      },
      PROTOCOLS.map(([id, label]) => /* @__PURE__ */ __dshReact.createElement("option", { key: id, value: id }, label))
    )), /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u5730\u5740\uFF08baseUrl\uFF09", wide: true, hint: "\u4E0D\u542B\u51ED\u636E\u3001\u67E5\u8BE2\u4E32\u6216 # \u7247\u6BB5" }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "jdg-input",
        value: draft.baseUrl ?? "",
        placeholder: "https://api.typesafe.ai/v1/systemone",
        onChange: (event) => setDraft({ ...draft, baseUrl: event.target.value })
      }
    )), /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u6A21\u578B", hint: "pin \u5230\u5177\u4F53\u7248\u672C\uFF0C\u522B\u7528 jev-latest \u8FD9\u7C7B\u79FB\u52A8\u522B\u540D" }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "jdg-input",
        value: draft.model ?? "",
        placeholder: "typesafe/jev-1.13",
        onChange: (event) => setDraft({ ...draft, model: event.target.value })
      }
    )), /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u5BC6\u94A5", wide: true, hint: `${draftKeyField.hint} \xB7 \u51ED\u636E\u540D ${draftRef}\uFF08\u4E5F\u53EF\u4EE5\u76F4\u63A5\u628A\u5B83\u5F53\u73AF\u5883\u53D8\u91CF\u540D\u7528\uFF0C\u73AF\u5883\u53D8\u91CF\u4F18\u5148\uFF09` }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "jdg-input",
        type: "password",
        autoComplete: "new-password",
        value: draft.key ?? "",
        placeholder: draftKeyField.placeholder,
        disabled: busy || draftKeyField.locked,
        onChange: (event) => setDraft({ ...draft, key: event.target.value })
      }
    )), /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u8D85\u65F6\uFF08ms\uFF09" }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "jdg-input",
        type: "number",
        min: "1",
        max: "300000",
        step: "1",
        value: draft.timeoutMs ?? "",
        onChange: (event) => setDraft({ ...draft, timeoutMs: event.target.value })
      }
    ))), /* @__PURE__ */ __dshReact.createElement("p", { className: "jdg-note" }, `\u5BC6\u94A5\u5199\u8FDB DSH \u51ED\u636E\u670D\u52A1\uFF08\u5F15\u7528\u540D ${draftRef}\uFF0C\u81EA\u52A8\u5206\u914D\uFF09\uFF0C\u4E0D\u5199\u8FDB\u914D\u7F6E\u3001\u4FDD\u5B58\u540E\u4E0D\u56DE\u663E\u3002`, ` \u7559\u7A7A\u5373\u4FDD\u6301\u539F\u503C\uFF1B\u8981\u79FB\u9664\u5BC6\u94A5\u8BF7\u5220\u9664\u8FD9\u6761\u8FDE\u63A5\uFF08\u5220\u9664\u4F1A\u4E00\u5E76\u6E05\u9664\u5B83\uFF09\u3002`, ` \u4E5F\u53EF\u4EE5\u4E0D\u5728\u8FD9\u91CC\u586B\uFF1A\u5728\u542F\u52A8\u73AF\u5883\u91CC\u8BBE ${draftRef}=\u2026 \uFF08\u6216\u5199\u8FDB ~/.dsh/.env\uFF09\u5373\u53EF\uFF0C\u542F\u52A8\u73AF\u5883\u4F18\u5148\u7EA7\u6700\u9AD8\uFF0C\u90A3\u65F6\u8FD9\u91CC\u4F1A\u663E\u793A\u4E3A\u53EA\u8BFB\u3002`), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-actionsRow" }, /* @__PURE__ */ __dshReact.createElement("button", { className: "jdg-button", "data-variant": "primary", disabled: busy, onClick: () => {
      void saveConnection();
    } }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), /* @__PURE__ */ __dshReact.createElement("button", { className: "jdg-button", "data-variant": "outline", disabled: busy, onClick: closeEditor }, "\u53D6\u6D88")));
  }
  function purposeCard(name) {
    const purpose = purposes[name] ?? {};
    const key = `purpose:${name}`;
    const open = expanded === key;
    const state = purposeStatus(purpose, connections, defaultConnection);
    const target = purposeTargetLabel(purpose, defaultConnection);
    return /* @__PURE__ */ __dshReact.createElement("li", { className: "jdg-card", key }, /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-cardRow" }, /* @__PURE__ */ __dshReact.createElement(
      "button",
      {
        type: "button",
        className: "jdg-cardToggle",
        "aria-expanded": open,
        onClick: () => toggle(key)
      },
      /* @__PURE__ */ __dshReact.createElement(Chevron, { open }),
      /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-cardIdentity" }, name, /* @__PURE__ */ __dshReact.createElement(Tag, { tone: state.tone === "ok" ? "ok" : "neutral" }, target))
    ), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-cardEnd" }, /* @__PURE__ */ __dshReact.createElement(Status, { tone: state.tone, text: state.text })), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-cardActions" }, /* @__PURE__ */ __dshReact.createElement(
      MoreMenu,
      {
        disabled: busy,
        items: [
          ["\u7F16\u8F91", () => openEdit("purpose", name), void 0, !writable],
          ["\u5220\u9664", () => {
            void removePurpose(name);
          }, "danger", !writable]
        ]
      }
    ))), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-cardDescription" }, String(purpose.connection ?? "") === "" ? "\u672A\u6307\u5B9A\u8FDE\u63A5\uFF1A\u8C03\u7528\u65F6\u843D\u5230\u300C\u9ED8\u8BA4\u8FDE\u63A5\u300D" : `\u6D88\u8D39\u8005\u62A5\u7528\u9014\u540D "${name}" \u65F6\uFF0C\u8D70\u8FDE\u63A5 "${purpose.connection}"`), open ? /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-cardDetails" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-details" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u6307\u5411\u8FDE\u63A5"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, String(purpose.connection ?? "") || "\uFF08\u8DDF\u968F\u9ED8\u8BA4\u8FDE\u63A5\uFF09"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u5B9E\u9645\u4F7F\u7528"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, state.tone === "danger" ? "\u65E0\u6CD5\u89E3\u6790" : target), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsKey" }, "\u8C03\u7528\u65B9\u5F0F"), /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-detailsValue" }, `ctx.judgment.ask(state, questions, { purpose: '${name}' })`))) : null);
  }
  function purposeForm() {
    return /* @__PURE__ */ __dshReact.createElement("li", { className: "jdg-card", key: "purpose:form" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-formGrid" }, /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u7528\u9014\u540D", hint: "\u6D88\u8D39\u8005\u7528\u5B83\u6765\u8981\u80FD\u529B\uFF0C\u4F8B\u5982 mobile.action / browser.action" }, /* @__PURE__ */ __dshReact.createElement(
      "input",
      {
        className: "jdg-input",
        value: draft.name ?? "",
        readOnly: editor?.isNew !== true,
        placeholder: "mobile.action",
        onChange: (event) => setDraft({ ...draft, name: event.target.value })
      }
    )), /* @__PURE__ */ __dshReact.createElement(Field, { label: "\u6307\u5411\u8FDE\u63A5" }, /* @__PURE__ */ __dshReact.createElement(
      "select",
      {
        className: "jdg-select",
        value: draft.connection ?? "",
        onChange: (event) => setDraft({ ...draft, connection: event.target.value })
      },
      /* @__PURE__ */ __dshReact.createElement("option", { value: "" }, "\u8DDF\u968F\u9ED8\u8BA4\u8FDE\u63A5"),
      Object.keys(connections).map((id) => /* @__PURE__ */ __dshReact.createElement("option", { key: id, value: id }, id))
    ))), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-actionsRow" }, /* @__PURE__ */ __dshReact.createElement("button", { className: "jdg-button", "data-variant": "primary", disabled: busy, onClick: () => {
      void savePurpose();
    } }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), /* @__PURE__ */ __dshReact.createElement("button", { className: "jdg-button", "data-variant": "outline", disabled: busy, onClick: closeEditor }, "\u53D6\u6D88")));
  }
  const connectionCards = [
    ...editor?.kind === "connection" && editor.isNew === true ? [connectionForm()] : [],
    ...connectionIds.map((id) => editingConnection === id ? connectionForm() : connectionCard(id))
  ];
  const purposeCards = [
    ...editor?.kind === "purpose" && editor.isNew === true ? [purposeForm()] : [],
    ...purposeIds.map((name) => editingPurpose === name ? purposeForm() : purposeCard(name))
  ];
  const connectionCount = Object.keys(connections).length;
  const purposeCount = Object.keys(purposes).length;
  const lists = {
    connections: {
      tab: `\u8FDE\u63A5\uFF08${connectionCount}\uFF09`,
      summary: `\u5171 ${connectionCount} \u6761 \xB7 \u6BCF\u6761 = \uFF08\u534F\u8BAE \xB7 \u5730\u5740 \xB7 \u6A21\u578B \xB7 \u51ED\u636E\u5F15\u7528\uFF09\uFF1B\u5BC6\u94A5\u503C\u4E0D\u5728\u914D\u7F6E\u91CC\uFF0C\u53EA\u5B58\u5F15\u7528\u540D`,
      placeholder: "\u641C\u7D22\u8FDE\u63A5\u540D / \u5730\u5740 / \u6A21\u578B",
      addLabel: "\u65B0\u589E\u8FDE\u63A5",
      empty: "\u8FD8\u6CA1\u6709\u8FDE\u63A5\u3002\u4E00\u6761\u8FDE\u63A5\u5C31\u662F\u4E00\u7EC4\u300C\u534F\u8BAE + \u5730\u5740 + \u6A21\u578B + \u51ED\u636E\u5F15\u7528\u300D\u3002",
      cards: connectionCards
    },
    purposes: {
      tab: `\u7528\u9014\uFF08${purposeCount}\uFF09`,
      summary: `\u5171 ${purposeCount} \u4E2A \xB7 \u7ED9\u6D88\u8D39\u8005\u4E00\u4E2A\u7A33\u5B9A\u540D\u5B57\uFF1A\u4EE3\u7801\u91CC\u53EA\u5199\u7528\u9014\u540D\uFF0C\u6362\u8FDE\u63A5 / \u6362\u6A21\u578B / \u6362\u5BC6\u94A5\u90FD\u4E0D\u7528\u6539\u4EE3\u7801`,
      placeholder: "\u641C\u7D22\u7528\u9014\u540D / \u6307\u5411\u8FDE\u63A5",
      addLabel: "\u65B0\u589E\u7528\u9014",
      empty: "\u8FD8\u6CA1\u6709\u7528\u9014\u3002\u6D88\u8D39\u8005\u7528\u7528\u9014\u540D\u8981\u80FD\u529B\uFF08\u4F8B\u5982 mobile.action\uFF09\uFF0C\u5728\u8FD9\u91CC\u628A\u5B83\u6307\u5411\u4E00\u6761\u8FDE\u63A5\u3002",
      cards: purposeCards
    }
  };
  const active = lists[tab] ?? lists.connections;
  void tick;
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-page" }, /* @__PURE__ */ __dshReact.createElement("style", null, styles_default), /* @__PURE__ */ __dshReact.createElement("header", { className: "jdg-pageHead" }, /* @__PURE__ */ __dshReact.createElement("div", null, /* @__PURE__ */ __dshReact.createElement("h2", { className: "jdg-pageTitle" }, "\u51B3\u7B56"), /* @__PURE__ */ __dshReact.createElement("p", { className: "jdg-pageIntro" }, "\u7ED3\u6784\u5316\u5224\u65AD\u80FD\u529B\uFF1A\u4E00\u6B21\u8C03\u7528 = \u4E00\u4EFD\u72B6\u6001 + \u4E00\u6279\u547D\u540D\u95EE\u9898 \u2192 \u6982\u7387\u7B54\u6848\u3002\u5B83\u5224\u65AD\uFF0C\u6D88\u8D39\u8005\u51B3\u5B9A\u3002"))), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-tabs" }, Object.entries(lists).map(([id, list]) => /* @__PURE__ */ __dshReact.createElement("button", { type: "button", key: id, className: "jdg-tab", "data-active": tab === id, onClick: () => selectTab(id) }, list.tab))), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-summary" }, active.summary), /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-filterRow" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-search" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-searchIcon" }, /* @__PURE__ */ __dshReact.createElement(SearchIcon, null)), /* @__PURE__ */ __dshReact.createElement(
    "input",
    {
      className: "jdg-searchInput",
      value: query,
      placeholder: active.placeholder,
      onChange: (event) => setQuery(event.target.value)
    }
  )), /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      className: "jdg-button",
      "data-variant": "primary",
      disabled: busy || !writable,
      onClick: () => openCreate(tab === "connections" ? "connection" : "purpose")
    },
    active.addLabel
  )), status === "loading" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "jdg-empty" }, "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026") : null, writable ? null : /* @__PURE__ */ __dshReact.createElement("p", { className: "jdg-note" }, "\u5F53\u524D\u8BBE\u7F6E\u6587\u6863\u4E0D\u53EF\u5199\uFF1A\u8FD9\u4E2A profile \u91CC\u8BE5\u63D2\u4EF6\u7684\u914D\u7F6E\u88AB\u66F4\u9AD8\u5C42\u8986\u76D6\u4E86\u3002"), error !== "" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "jdg-error" }, error) : null, tab === "purposes" ? /* @__PURE__ */ __dshReact.createElement("div", { className: "jdg-inlineRow" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "jdg-label" }, "\u672A\u6307\u5B9A\u8FDE\u63A5\u7684\u7528\u9014\u843D\u5230"), /* @__PURE__ */ __dshReact.createElement(
    "select",
    {
      className: "jdg-select",
      value: defaultConnection,
      disabled: busy || !writable,
      onChange: (event) => {
        void commit("defaultConnection", event.target.value);
      }
    },
    /* @__PURE__ */ __dshReact.createElement("option", { value: "" }, "\u672A\u8BBE\u7F6E \u2014\u2014 \u53EA\u914D\u4E86\u4E00\u6761\u8FDE\u63A5\u65F6\u7528\u90A3\u4E00\u6761\uFF0C\u5426\u5219\u8C03\u7528\u5FC5\u987B\u7ED9\u7528\u9014\u540D"),
    Object.keys(connections).map((id) => /* @__PURE__ */ __dshReact.createElement("option", { key: id, value: id }, id))
  )) : null, /* @__PURE__ */ __dshReact.createElement("ul", { className: "jdg-cards" }, active.cards.length === 0 ? /* @__PURE__ */ __dshReact.createElement("li", { className: "jdg-empty" }, query === "" ? active.empty : "\u6CA1\u6709\u5339\u914D\u7684\u6761\u76EE\u3002") : active.cards), /* @__PURE__ */ __dshReact.createElement(
    ConfirmDialog,
    {
      dialog: confirm,
      primitives: props.primitives,
      pending: confirmPending,
      error: confirmError,
      onCancel: () => {
        setConfirm(null);
        setConfirmError("");
      },
      onConfirm: () => {
        void confirmRemove();
      }
    }
  ));
}

// client/index.jsx
var inject = ["slots", "configForms", "remote", "remote.credentials"];
async function apply(ctx) {
  const { form, entryId } = findForm(ctx);
  let credentials;
  try {
    credentials = ctx.remote?.credentials;
  } catch {
    credentials = void 0;
  }
  let judgment;
  try {
    await ctx.remote.$mount(judgmentContribution());
  } catch (error) {
    console.warn("[judgment] Remote $mount \u5931\u8D25\uFF0C\u81EA\u68C0\u6309\u94AE\u5C06\u4E0D\u53EF\u7528\uFF1A", error);
  }
  try {
    judgment = ctx.get("remote.judgment");
  } catch (error) {
    judgment = void 0;
    console.warn("[judgment] \u53D6 remote.judgment \u5931\u8D25\uFF0C\u81EA\u68C0\u6309\u94AE\u5C06\u4E0D\u53EF\u7528\uFF1A", error);
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "judgment",
    order: 21,
    label: () => "\u51B3\u7B56",
    // primitives 见 client/primitives.js：走宿主模块表的同步 require。
    inject: () => ({ form, entryId, credentials, primitives, judgment })
  }, Panel));
}
return module.exports; } });
