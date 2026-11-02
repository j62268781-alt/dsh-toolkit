window.__ModuleLoader__.load({ id: "dsh-agent-browser", factory: (require) => {
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

// client/browser-remote.js
var PACKAGE = "dsh-agent-browser";
var SERVICE = "browser";
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
    // 结果原样透传（`ProbeResult` 全是 JSON 值）。
    result: { mode: "src-json" }
  };
}
function browserContribution() {
  return {
    package: PACKAGE,
    descriptors: [
      // host: probe() —— 安装自检：**零实参**，客户端一个都不能多传
      descriptor("probe", []),
      // host: install(target) —— 帮忙装 CLI（'cli'）；wire 名必须等于形参名
      descriptor("installCli", ["target"]),
      // host: checkJudgment() —— 「决策」的依赖检查（零实参）：dsh-judgment 的 ctx.judgment 在不在
      descriptor("checkJudgment", [])
    ]
  };
}

// client/config.js
var ENTRY_CANDIDATES = ["agent-browser", "dsh-agent-browser"];
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
function objectOf(value, field) {
  const group = value?.[field];
  return group !== null && typeof group === "object" && !Array.isArray(group) ? group : {};
}
function arrayOf(value, field) {
  const list = value?.[field];
  return Array.isArray(list) ? list : [];
}
var DOMAIN_PATTERN = /^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
var SESSION_PATTERN = /^[A-Za-z0-9._-]*$/;
function parseDomains(text) {
  const parts = String(text ?? "").split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== "");
  const invalid = parts.filter((part) => !DOMAIN_PATTERN.test(part));
  return { domains: parts, invalid };
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
var import_react3 = require("react");

// client/styles.css
var styles_default = "/*\r\n * \u6D4F\u89C8\u5668\u8BBE\u7F6E\u9875\u6837\u5F0F\u3002\u7C7B\u540D\u4E00\u5F8B ab- \u524D\u7F00\uFF1A\u6837\u5F0F\u662F\u9875\u9762\u6302\u8F7D\u65F6\u5168\u5C40\u6CE8\u5165\u7684\uFF0C\u522B\u7684\u8BBE\u7F6E\u9875\r\n * \uFF08jdg-\u3001smp-\uFF09\u53EF\u80FD\u540C\u65F6\u6302\u8F7D\uFF0C\u4E0D\u80FD\u5171\u7528\u7C7B\u540D\u3002\r\n *\r\n * \u5C3A\u5BF8\u4E8B\u5B9E\u6765\u81EA DSH\u300C\u901A\u7528\u8BBE\u7F6E\u300D\u9762\u677F\uFF08dsh-client-ui-settings-general \u7684 DeveloperToolsRow\uFF09\uFF1A\r\n *   \u884C      justify-content:space-between; align-items:center; gap:24px;\r\n *           padding:16px 0; border-bottom:.5px solid var(--dsw-alias-border-l2)\r\n *   \u6807\u9898    14px / 20px\r\n *   \u5B50\u6807\u9898  12px / 18px + --dsw-alias-label-secondary\uFF0Cmargin-top:4px\r\n *   \u672B\u884C    General \u7684 `:last-child{border-bottom:none}` \u2014\u2014 \u6211\u4EEC\u4E5F\u53EA\u5728\u6574\u9875\u6700\u540E\u4E00\u884C\u53BB\u6389\r\n * \u9875\u5934\u6CBF\u7528\u672C\u63D2\u4EF6\u65CF\u65E2\u6709\u7EA6\u5B9A\uFF08dsh-judgment \u7684 .jdg-pageTitle/.jdg-pageIntro\uFF09\uFF1A\r\n *   \u6807\u9898 18px/500 \xB7 \u526F\u6807\u9898 13px/20px secondary\r\n * \u6309\u94AE\u9010\u5B57\u6284 skills-mcp \u7684 `.smp-button`\uFF08\u542B `flex:none`\u2014\u2014\u5C11\u4E86\u5B83\u4F1A\u88AB\u5DE6\u5217\u6324\u6210\u7AD6\u6392\uFF09\u3002\r\n */\r\n\r\n.ab-page{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:18px;display:flex}\r\n.ab-page>*{width:100%;max-width:960px}\r\n\r\n.ab-pageHead{box-sizing:border-box;display:flex;flex-direction:column;gap:4px}\r\n.ab-pageTitle{margin:0;font-size:18px;font-weight:500;line-height:26px}\r\n.ab-pageIntro{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}\r\n\r\n.ab-section{display:flex;flex-direction:column}\r\n\r\n/* \u6BCF\u4E00\u884C\u90FD\u957F\u4E00\u6837\uFF1A\u540C\u4E00\u6761 16px \u7AD6\u8DDD + \u540C\u4E00\u6761\u4E0B\u8FB9\u6846\uFF1B\u53EA\u6709\u6574\u9875\u6700\u540E\u4E00\u884C\u6CA1\u6709\u3002 */\r\n.ab-row{box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}\r\n.ab-section>.ab-row:last-child{border-bottom:none}\r\n/* \u6574\u9875\u7B2C\u4E00\u884C\u4E0D\u7559\u4E0A\u5185\u8FB9\u8DDD\uFF1Asummary \u2192 \u7B2C\u4E00\u884C\u7684\u89C6\u89C9\u95F4\u8DDD\u5C31\u7B49\u4E8E\u300C\u526F\u6807\u9898 \u2192 summary\u300D\u7684 flex gap\uFF0C\r\n   \u5426\u5219\u4F1A\u591A\u51FA\u4E00\u4EFD 16px\uFF08\u771F\u673A\u53CD\u9988\uFF1A\u90A3\u91CC\u663E\u5F97\u592A\u5927\uFF09\u3002 */\r\n.ab-section>.ab-row:first-child{padding-top:0}\r\n\r\n/* \u5206\u7EC4\u6807\u9898\uFF1A\u6392\u7248\u4E0E\u300C\u5411\u4E0A\u7684\u95F4\u8DDD\u300D\u9010\u5B57\u6284\u300CAgent \u9884\u8BBE\u300D\u9875\uFF08ui-agent-preset \u7684\r\n   `.FfBBxq_groupHead` + `.FfBBxq_group+.FfBBxq_group{margin-top:20px}`\uFF09\uFF1A\r\n   12px / 600 / tertiary / letter-spacing .06em\uFF1B\u7EC4\u4E0E\u7EC4\u4E4B\u95F4 20px\u3002\r\n   \u6CE8\u610F\uFF1A\u4E0A\u4E00\u884C\u81EA\u5E26 16px \u4E0B\u5185\u8FB9\u8DDD\uFF0C\u6240\u4EE5\u89C6\u89C9\u4E0A\u6807\u9898\u4E0A\u65B9\u7EA6 36px\u3001\u4E0B\u65B9 16px\u2014\u2014\u6807\u9898\u660E\u663E\u66F4\u9760\u8FD1\r\n   \u5B83\u6807\u6CE8\u7684\u90A3\u7EC4\u3002\u884C\u8DDD\u672C\u8EAB\u4E0D\u4E3A\u4E86\u6807\u9898\u7834\u4F8B\uFF08\u6BCF\u4E00\u884C\u4ECD\u662F\u7EDF\u4E00\u7684 16px\uFF09\u3002 */\r\n.ab-groupTitle{margin:20px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;line-height:18px;letter-spacing:.06em;text-transform:uppercase}\r\n.ab-rowText{display:flex;flex-direction:column;min-width:0}\r\n.ab-rowTitle{font-size:14px;line-height:20px}\r\n.ab-rowSubtitle{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}\r\n.ab-rowControl{display:inline-flex;align-items:center;gap:8px;flex:none}\r\n/* \u53EA\u6709\u6587\u672C\u8F93\u5165\u8981\u5360\u5BBD\u3002**\u522B\u7ED9\u300C\u63A7\u4EF6\u5BB9\u5668\u5185\u7684\u6240\u6709\u5B69\u5B50\u300D\u7EDF\u4E00\u8BBE\u5BBD\u5EA6**\u2014\u2014\u90A3\u4F1A\u628A 36px \u7684 Switch\r\n   \u62C9\u6210\u6574\u5217\u5BBD\uFF0C\u5F00\u5173\u76F4\u63A5\u53D8\u5F62\uFF08\u771F\u673A\u8E29\u8FC7\uFF1A\u91CD\u542F\u540E\u5F00\u5173\u5168\u53D8\u5F62\uFF09\u3002\u53EA\u5BF9 .ab-input \u8BBE\u5BBD\u3002 */\r\n.ab-rowControl .ab-input{width:320px;max-width:100%}\r\n\r\n.ab-input{box-sizing:border-box;width:100%;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:0 10px}\r\n/* \u591A\u884C\u8F93\u5165\uFF08\u5141\u8BB8\u57DF\u540D\uFF09\uFF1A\u8DDF .ab-input \u540C\u4E00\u5957\u989C\u8272\u4E0E\u5706\u89D2\uFF0C\u53EF\u7EB5\u5411\u62C9\u9AD8\u3002 */\r\n.ab-textarea{box-sizing:border-box;width:100%;min-height:84px;resize:vertical;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:8px 10px}\r\n.ab-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}\r\n.ab-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}\r\n.ab-textarea:disabled{cursor:not-allowed}\r\n\r\n/* \u6570\u5B57\u6B65\u8FDB\u5668\uFF1A\u9010\u5B57\u6284\u300C\u901A\u7528\u8BBE\u7F6E \u2192 \u5B57\u53F7\u300D\u90A3\u884C\uFF08ui-theme \u7684 FontSizeRow \u7684 CSS\uFF09\uFF1A\r\n   \u6570\u503C\u5C45\u4E2D + \u53F3\u4FA7\u6D6E\u51FA\u4E0A\u4E0B\u7BAD\u5934\uFF08hover / \u805A\u7126\u624D\u663E\u5F62\uFF09\uFF0C\u5E95\u8272\u7528 bg-module-platform\u3002 */\r\n.ab-stepper{box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:72px;height:36px;padding-right:22px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}\r\n/* \u53EF\u8F93\u5165\u7684\u6B65\u8FDB\u5668\uFF1A6 \u4F4D\u6BEB\u79D2\uFF08600000\uFF09\u4E5F\u8981\u653E\u5F97\u4E0B\uFF0C\u4E14\u4E0D\u88AB\u53F3\u4FA7\u7BAD\u5934\u538B\u4F4F\u3002 */\r\n.ab-stepper[data-editable=true]{min-width:104px;padding-right:24px}\r\n/* \u4E0D\u5E26\u7BAD\u5934\u7684\u6570\u503C\u6846\uFF08\u6700\u5927\u8F93\u51FA / \u81EA\u5B9A\u4E49\u7A7A\u95F2\u8D85\u65F6\uFF09\uFF1A\u4E0D\u9700\u8981\u7ED9\u7BAD\u5934\u7559\u7A7A\u9699\u3002 */\r\n.ab-stepper[data-arrows=false]{padding-right:0}\r\n.ab-stepperValue{min-width:18px;text-align:center;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}\r\n.ab-stepperInput{width:72px;padding:0;border:none;outline:none;background:transparent;text-align:center;font:inherit;font-size:14px;line-height:22px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}\r\n.ab-stepperInput:disabled{cursor:not-allowed}\r\n.ab-stepperInput:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-xs)}\r\n.ab-stepperUnit{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}\r\n.ab-stepperArrows{position:absolute;right:8px;display:flex;flex-direction:column;gap:2px;opacity:0}\r\n.ab-stepper:hover .ab-stepperArrows,.ab-stepper:focus-within .ab-stepperArrows{opacity:1}\r\n.ab-stepper[data-disabled=true]{opacity:.5}\r\n.ab-stepperArrow{box-sizing:border-box;width:17px;height:12px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-xs);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent);color:var(--dsw-alias-label-primary);font-size:8px;line-height:1;cursor:pointer}\r\n.ab-stepperArrow:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}\r\n.ab-stepperArrow:disabled{opacity:.4;cursor:not-allowed}\r\n\r\n/* \u4E0A\u4E0B\u5E03\u5C40\u7684\u884C\uFF1A\u6587\u5B57\u5728\u4E0A\u3001\u63A7\u4EF6\u5728\u4E0B\u9762\u5360\u6EE1\u6574\u884C\uFF08\u7528\u4E8E\u9700\u8981\u5BBD\u5EA6\u7684\u63A7\u4EF6\uFF0C\u5982\u591A\u884C textarea\uFF09\u3002 */\r\n.ab-rowStacked{flex-direction:column;align-items:stretch;gap:10px}\r\n.ab-rowControlFull{display:block;width:100%}\r\n.ab-input::placeholder{color:var(--dsw-alias-label-tertiary)}\r\n\r\n/* \u9884\u8BBE\u4E0B\u62C9\uFF08\u7A7A\u95F2\u8D85\u65F6\uFF09\uFF1A\u4E0E .ab-input \u540C\u4E00\u5957\u5916\u89C2\uFF0C\u7A84\u4E00\u70B9\uFF0C\u81EA\u5E26 chevron\u3002 */\r\n.ab-select{box-sizing:border-box;height:32px;min-width:132px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);appearance:none;-webkit-appearance:none;padding:0 28px 0 10px;background-image:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6.5 8 10.5 12 6.5' stroke='%238b8f99' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 9px center;background-size:14px}\r\n.ab-select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}\r\n.ab-select:disabled{cursor:not-allowed}\r\n.ab-input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}\r\n.ab-input:disabled{cursor:not-allowed}\r\n\r\n/* \u4E0E skills-mcp \u7684 .smp-button \u540C\u4E00\u6761\u89C4\u5219\uFF1B`flex:none` \u662F\u91CD\u70B9\uFF08\u5426\u5219\u4F1A\u88AB\u6324\u6210\u7AD6\u6392\uFF09\u3002 */\r\n.ab-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:32px;padding:0 14px;border:.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;flex:none;white-space:nowrap}\r\n.ab-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}\r\n.ab-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}\r\n.ab-button[data-variant=outline]{border-color:var(--dsw-alias-border-l3)}\r\n.ab-button[data-variant=primary]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}\r\n.ab-button[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}\r\n.ab-button:disabled{opacity:.4;cursor:not-allowed}\r\n\r\n/* \u5B89\u88C5\u81EA\u68C0\u5361\u7247\uFF1A\u4E00\u53E5\u8BDD\u6807\u9898 + \u53F3\u4FA7\u52A8\u4F5C\uFF0C\u4E0B\u9762\u5C31\u662F\u90A3\u4E24\u9879\u68C0\u67E5\u3002 */\r\n.ab-summary{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,var(--dsw-radius-md));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1))}\r\n.ab-summary[data-tone=ok]{border-color:var(--dsw-alias-state-success-primary,#12805c)}\r\n.ab-summary[data-tone=danger]{border-color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.ab-summaryHead{display:flex;align-items:center;gap:10px}\r\n.ab-summaryTitle{flex:1 1 auto;min-width:0;font-size:14px;line-height:20px}\r\n.ab-summaryAction{flex:none;display:inline-flex}\r\n\r\n.ab-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#9aa4b2)}\r\n.ab-dot[data-dot=ok]{background:var(--dsw-alias-state-success-primary,#067647)}\r\n.ab-dot[data-dot=danger]{background:var(--dsw-alias-state-error-primary,#d92d20)}\r\n\r\n/* \u4E00\u9879\u68C0\u67E5 = \u4E00\u884C\uFF1A\u2713/\u2717 + \u540D\u5B57 + \u7ED3\u8BBA\uFF08+ \u9700\u8981\u65F6\u53F3\u4FA7\"\u5B89\u88C5\"\uFF09\u3002 */\r\n.ab-check{display:flex;flex-direction:column;gap:2px;padding-left:18px}\r\n.ab-checkHead{display:flex;align-items:center;gap:8px;min-width:0}\r\n.ab-checkMark{flex:none;width:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary,#067647)}\r\n.ab-check[data-status=fail] .ab-checkMark{color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.ab-checkLabel{flex:none;width:104px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\r\n.ab-checkMessage{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}\r\n.ab-check[data-status=fail] .ab-checkMessage{color:var(--dsw-alias-state-error-primary,#d92d20)}\r\n.ab-checkAction{flex:none;display:inline-flex;margin-left:auto}\r\n.ab-checkFix{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}\r\n\r\n.ab-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}\r\n.ab-error{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-size:12px;line-height:18px;margin:0}\r\n";

// client/panel.jsx
function Panel(props) {
  const form = props.form;
  const browserRef = (0, import_react3.useRef)(props.browser);
  browserRef.current = props.browser;
  const [tick, setTick] = (0, import_react3.useState)(0);
  const [error, setError] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [probe, setProbe] = (0, import_react3.useState)(null);
  async function toggleDecision(next) {
    if (!next) {
      await setGroup("tools", tools, "decision", false);
      return;
    }
    try {
      const envelope = await browserRef.current?.checkJudgment?.();
      if (envelope?.ok !== true || envelope.value?.available !== true) {
        setError(String(envelope?.value?.reason ?? envelope?.error?.message ?? "\u65E0\u6CD5\u786E\u8BA4 dsh-judgment \u662F\u5426\u53EF\u7528\uFF0C\u672A\u5F00\u542F\u300C\u51B3\u7B56\u300D"));
        return;
      }
    } catch (cause) {
      setError(`\u65E0\u6CD5\u786E\u8BA4 dsh-judgment \u662F\u5426\u53EF\u7528\uFF08${String(cause?.message ?? cause)}\uFF09\uFF0C\u672A\u5F00\u542F\u300C\u51B3\u7B56\u300D`);
      return;
    }
    await setGroup("tools", tools, "decision", true);
  }
  const [probing, setProbing] = (0, import_react3.useState)(false);
  const [probeError, setProbeError] = (0, import_react3.useState)("");
  const [installing, setInstalling] = (0, import_react3.useState)(false);
  const [installNote, setInstallNote] = (0, import_react3.useState)("");
  const judgmentState = probe === null ? probeError === "" ? "checking" : "unknown" : probe.apiVersion !== PROBE_API_VERSION ? "unknown" : probe.judgment === true ? "ready" : "missing";
  const judgmentReady = judgmentState === "ready";
  (0, import_react3.useEffect)(() => {
    if (typeof form?.subscribe !== "function") return void 0;
    return form.subscribe(() => setTick((count) => count + 1));
  }, [form]);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    let waits = 0;
    const start = () => {
      if (cancelled) return;
      if (browserRef.current === void 0 && waits < 30) {
        waits += 1;
        setTimeout(start, 100);
        return;
      }
      void runProbe();
    };
    start();
    return () => {
      cancelled = true;
    };
  }, []);
  async function runProbe() {
    const browser2 = browserRef.current;
    if (browser2 === void 0) {
      setProbeError("\u81EA\u68C0\u901A\u8DEF\u4E0D\u53EF\u7528\uFF08host \u534A\u672A\u52A0\u8F7D\uFF0C\u6216\u63D2\u4EF6\u7248\u672C\u4E0E\u5BA2\u6237\u7AEF\u534A\u4E0D\u4E00\u81F4\uFF09");
      return;
    }
    setProbing(true);
    setProbeError("");
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const envelope = await browser2.probe();
        if (envelope?.ok !== true) throw new Error(envelope?.error?.message ?? "\u81EA\u68C0\u5931\u8D25");
        setProbe(envelope.value ?? null);
        setProbing(false);
        return;
      } catch (cause) {
        last = cause;
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    setProbeError(String(last?.message ?? last));
    setProbing(false);
  }
  async function runInstall(target) {
    const browser2 = browserRef.current;
    if (browser2 === void 0) return;
    setInstalling(true);
    setInstallNote("\u6B63\u5728\u5B89\u88C5\u2026\uFF08\u53EF\u80FD\u8981\u51E0\u5206\u949F\uFF09");
    try {
      const envelope = await browser2.installCli(target);
      if (envelope?.ok !== true) throw new Error(envelope?.error?.message ?? "\u5B89\u88C5\u5931\u8D25");
      setInstallNote(envelope.value?.message ?? "\u5B89\u88C5\u7ED3\u675F");
      await runProbe();
    } catch (cause) {
      setInstallNote(`\u5B89\u88C5\u5931\u8D25\uFF1A${String(cause?.message ?? cause)}`);
    } finally {
      setInstalling(false);
    }
  }
  const value = snapshotOf(form);
  const status = statusOf(form);
  const browser = objectOf(value, "browser");
  const tools = objectOf(value, "tools");
  const limits = objectOf(value, "limits");
  const session = objectOf(value, "session");
  const judgment = objectOf(value, "judgment");
  const writable = typeof form?.set === "function" || typeof props.mutate === "function";
  const enabled = value.enabled !== false;
  const decision = tools.decision === true;
  const screenshot = tools.screenshot !== false;
  const raw = tools.raw === true;
  const headed = browser.headed === true;
  const contentBoundaries = browser.contentBoundaries !== false;
  async function commit(field, next) {
    setBusy(true);
    setError("");
    try {
      let accepted = true;
      if (typeof form?.set === "function") accepted = await form.set(field, next);
      else if (typeof props.mutate === "function") accepted = await props.mutate(props.entryId, [{ op: "set", path: [field], value: next }]);
      else throw new Error("\u914D\u7F6E\u8868\u5355\u4E0D\u53EF\u5199\uFF1A\u5BBF\u4E3B\u65E2\u6CA1\u6709 set \u4E5F\u6CA1\u6709 mutate");
      if (accepted === false) throw new Error(`\u5BBF\u4E3B\u62D2\u7EDD\u4E86\u8FD9\u6B21\u5199\u5165\uFF08${field}\uFF09\uFF1A\u914D\u7F6E\u53EF\u80FD\u672A\u901A\u8FC7\u6821\u9A8C\uFF0C\u6216\u5F53\u524D\u6587\u6863\u4E0D\u53EF\u5199`);
      setTick((count) => count + 1);
      return true;
    } catch (cause) {
      setError(String(cause?.message ?? cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function setGroup(name, group, key, next) {
    return commit(name, { ...group, [key]: next });
  }
  void tick;
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-page" }, /* @__PURE__ */ __dshReact.createElement("style", null, styles_default), /* @__PURE__ */ __dshReact.createElement("header", { className: "ab-pageHead" }, /* @__PURE__ */ __dshReact.createElement("h2", { className: "ab-pageTitle" }, "\u6D4F\u89C8\u5668"), /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-pageIntro" }, "agent-browser\uFF08Rust + CDP\uFF09\u7684\u7A84\u5DE5\u5177\u9762\uFF1A\u5FEB\u7167\u3001\u4E00\u4E2A\u52A8\u4F5C\u3001\u8BFB\u53D6\u3001\u4F1A\u8BDD\uFF1B\u53EF\u9009\u4E00\u4E2A\u7531 ctx.judgment \u5224\u65AD\u7684\u76EE\u6807\u5FAA\u73AF\u3002\u5DE5\u5177\u53EA\u5728\u5F00\u542F\u65F6\u8FDB\u6A21\u578B\u4E0A\u4E0B\u6587\uFF0C\u5173\u6389\u5373\u96F6\u6210\u672C\u3002")), status === "loading" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-note" }, "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026") : null, writable ? null : /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-note" }, "\u5F53\u524D\u8BBE\u7F6E\u6587\u6863\u4E0D\u53EF\u5199\uFF1A\u8FD9\u4E2A profile \u91CC\u8BE5\u63D2\u4EF6\u7684\u914D\u7F6E\u88AB\u66F4\u9AD8\u5C42\u8986\u76D6\u4E86\u3002"), error !== "" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-error", role: "alert" }, error) : null, probe === null && probeError === "" ? null : /* @__PURE__ */ __dshReact.createElement(
    InstallSummary,
    {
      probe,
      probing,
      error: probeError,
      installing,
      note: installNote,
      onCheck: () => {
        void runProbe();
      },
      onInstall: (target) => {
        void runInstall(target);
      }
    }
  ), decision && judgmentState === "missing" ? /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-error", role: "alert" }, "\u300C\u51B3\u7B56\u300D\u5DF2\u5F00\u542F\uFF0C\u4F46 dsh-judgment \u4E0D\u53EF\u7528\uFF1Abrowser_run \u4E0D\u4F1A\u6CE8\u518C\u3002\u88C5\u4E0A dsh-judgment \u5E76\u91CD\u542F DSH\uFF0C\u6216\u5148\u5728\u8FD9\u91CC\u5173\u6389\u51B3\u7B56\u3002") : null, /* @__PURE__ */ __dshReact.createElement("section", { className: "ab-section" }, /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u6D4F\u89C8\u5668\u529F\u80FD",
      subtitle: "\u5173\u95ED\u540E\u4E0D\u6CE8\u518C\u4EFB\u4F55\u5DE5\u5177\uFF08\u6A21\u578B\u9762\u524D\u96F6\u6210\u672C\uFF09\uFF0C\u4E5F\u4E0D\u518D\u542F\u52A8\u4F1A\u8BDD\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        Switch,
        {
          primitives: props.primitives,
          label: "\u6D4F\u89C8\u5668\u529F\u80FD",
          checked: enabled,
          disabled: busy || !writable,
          onChange: (next) => {
            void commit("enabled", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u51B3\u7B56",
      subtitle: judgmentState === "ready" ? `${JUDGMENT_HINTS.ready}\uFF08\u7528\u9014\u540D ${String(judgment.purpose ?? "browser.action")}\uFF09` : JUDGMENT_HINTS[judgmentState] ?? JUDGMENT_HINTS.unknown,
      control: /* @__PURE__ */ __dshReact.createElement(
        Switch,
        {
          primitives: props.primitives,
          label: "\u51B3\u7B56",
          checked: decision,
          disabled: !enabled || busy || !writable || !judgmentReady,
          onChange: (next) => {
            void toggleDecision(next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement("h3", { className: "ab-groupTitle" }, "\u5DE5\u5177\u9762"), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u622A\u56FE\u5DE5\u5177",
      subtitle: "browser_screenshot\uFF1A\u89C6\u89C9\u515C\u5E95\uFF0C\u6216\u628A\u9875\u9762\u7ED9\u4F60\u770B\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        Switch,
        {
          primitives: props.primitives,
          label: "\u622A\u56FE\u5DE5\u5177",
          checked: screenshot,
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("tools", tools, "screenshot", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u9003\u751F\u8231 browser_raw",
      subtitle: "\u767D\u540D\u5355\u5185\u7684\u5176\u5B83 CLI \u5B50\u547D\u4EE4\uFF08get / find / network / storage \u2026\uFF09\u3002\u7981 mcp\u3001chat\u3001install\u3001plugin\u3001connect\u3001auth\u3001--cdp\u3001--profile\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        Switch,
        {
          primitives: props.primitives,
          label: "\u9003\u751F\u8231",
          checked: raw,
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("tools", tools, "raw", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement("h3", { className: "ab-groupTitle" }, "\u8FDB\u9636"), /* @__PURE__ */ __dshReact.createElement(
    StackedRow,
    {
      title: "\u5141\u8BB8\u57DF\u540D",
      subtitle: "--allowed-domains\uFF1A\u4E00\u884C\u4E00\u4E2A\uFF08\u9017\u53F7\u4E5F\u884C\uFF09\uFF0C\u5982 a.com\u3001*.b.com\u3002\u7559\u7A7A = \u4E0D\u9650\u5236\u3002\u8BBE\u4E86\u5B83\u5C31\u4E0D\u80FD\u518D\u7528 profile\uFF08CLI \u7684 fail-closed\uFF09\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        TextArea,
        {
          value: arrayOf(browser, "allowedDomains").join("\n"),
          placeholder: "a.com\n*.b.com",
          rows: 4,
          disabled: !enabled || busy || !writable,
          onCommit: (text) => {
            const { domains, invalid } = parseDomains(text);
            if (invalid.length > 0) {
              setError(`\u57DF\u540D\u683C\u5F0F\u4E0D\u5408\u6CD5\uFF1A${invalid.join("\u3001")}`);
              return;
            }
            void setGroup("browser", browser, "allowedDomains", domains);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u4F1A\u8BDD\u540D",
      subtitle: "--session\uFF1A\u6BCF\u4E2A agent \u4E00\u4E2A\u547D\u540D\u4F1A\u8BDD\uFF0C\u907F\u514D\u52AB\u6301\u522B\u7684 agent \u6216\u4EBA\u7C7B\u5F00\u7740\u7684\u7A97\u53E3\u3002\u7559\u7A7A = dsh-agent-browser\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        TextField,
        {
          value: String(session.name ?? ""),
          placeholder: "dsh-agent-browser",
          disabled: !enabled || busy || !writable,
          onCommit: (text) => {
            const next = text.trim();
            if (!SESSION_PATTERN.test(next)) {
              setError("\u4F1A\u8BDD\u540D\u53EA\u80FD\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001. - _");
              return;
            }
            void setGroup("session", session, "name", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u6709\u5934\u6A21\u5F0F",
      subtitle: "--headed\uFF1A\u663E\u793A\u6D4F\u89C8\u5668\u7A97\u53E3\u3002\u624B\u5DE5\u767B\u5F55\u6ED1\u5757/\u9A8C\u8BC1\u7801\u65F6\u9700\u8981\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        Switch,
        {
          primitives: props.primitives,
          label: "\u6709\u5934\u6A21\u5F0F",
          checked: headed,
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("browser", browser, "headed", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u547D\u4EE4\u8D85\u65F6",
      subtitle: "\u5355\u6761 CLI \u547D\u4EE4\u6700\u957F\u7B49\u591A\u4E45\uFF08\u6BEB\u79D2\uFF09\u3002\u4E0A\u4E0B\u952E\u6BCF\u6B21 100ms\uFF1B\u4E5F\u53EF\u4EE5\u70B9\u6570\u5B57\u76F4\u63A5\u8F93\u5165\u7CBE\u786E\u503C\u3002\u8D85\u65F6\u547D\u4EE4\u4F1A\u88AB\u6740\u6389\uFF0C\u4E0D\u4F1A\u4E00\u76F4\u6302\u7740\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        NumberStepper,
        {
          primitives: props.primitives,
          value: Number(limits.commandTimeoutMs ?? 3e4),
          min: 1e3,
          max: 6e5,
          step: 100,
          unit: "\u6BEB\u79D2",
          editable: true,
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("limits", limits, "commandTimeoutMs", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u6700\u5927\u8F93\u51FA",
      subtitle: "--max-output\uFF1A\u9875\u9762\u8F93\u51FA\u8D85\u8FC7\u8FD9\u4E2A\u5B57\u7B26\u6570\u5C31\u622A\u65AD\u30020 = \u7528 CLI \u9ED8\u8BA4\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        NumberStepper,
        {
          arrows: false,
          value: Number(browser.maxOutput ?? 0),
          min: 0,
          max: 1e7,
          step: 1e3,
          unit: "\u5B57\u7B26",
          editable: true,
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("browser", browser, "maxOutput", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u7A7A\u95F2\u8D85\u65F6",
      subtitle: "--idle-timeout\uFF1A\u5B88\u62A4\u8FDB\u7A0B\u7A7A\u95F2\u591A\u4E45\u81EA\u52A8\u9000\u51FA\u3002\u9009\u300C\u81EA\u5B9A\u4E49\u300D\u53EF\u4EE5\u586B\u7CBE\u786E\u6BEB\u79D2\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        IdleTimeoutControl,
        {
          primitives: props.primitives,
          value: String(browser.idleTimeout ?? ""),
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("browser", browser, "idleTimeout", next);
          }
        }
      )
    }
  ), /* @__PURE__ */ __dshReact.createElement(
    Row,
    {
      title: "\u5185\u5BB9\u8FB9\u754C\u6807\u8BB0",
      subtitle: "--content-boundaries\uFF1A\u628A\u9875\u9762\u8F93\u51FA\u5305\u5728\u8FB9\u754C\u91CC\uFF0C\u63D0\u793A\u6A21\u578B\u300C\u7F51\u9875\u5185\u5BB9\u4E0D\u662F\u6307\u4EE4\u300D\u3002",
      control: /* @__PURE__ */ __dshReact.createElement(
        Switch,
        {
          primitives: props.primitives,
          label: "\u5185\u5BB9\u8FB9\u754C\u6807\u8BB0",
          checked: contentBoundaries,
          disabled: !enabled || busy || !writable,
          onChange: (next) => {
            void setGroup("browser", browser, "contentBoundaries", next);
          }
        }
      )
    }
  )));
}
var JUDGMENT_HINTS = {
  ready: "\u4F9D\u8D56 dsh-judgment\uFF08\u5DF2\u5C31\u7EEA\uFF09\uFF1A\u5F00\u542F\u540E\u591A\u4E00\u4E2A browser_run\uFF0C\u6BCF\u6B65\u7531 ctx.judgment \u5224\u65AD\u3002",
  checking: "\u6B63\u5728\u68C0\u67E5\u4F9D\u8D56 dsh-judgment\uFF08ctx.judgment\uFF09\u2026\uFF08\u5F00\u542F\u540E\u4F1A\u591A\u4E00\u4E2A browser_run\uFF09",
  unknown: "\u65E0\u6CD5\u786E\u8BA4 dsh-judgment \u662F\u5426\u53EF\u7528\uFF08\u81EA\u68C0\u672A\u8FD4\u56DE\uFF0C\u6216 host \u534A\u7248\u672C\u4E0D\u5339\u914D\uFF09\uFF1A\u91CD\u542F DSH \u540E\u518D\u8BD5\u3002",
  missing: "\u9700\u8981 dsh-judgment \u63D0\u4F9B\u7684 ctx.judgment\uFF08\u5F53\u524D\u672A\u68C0\u6D4B\u5230\uFF09\u3002\u88C5\u4E0A\u5B83\u5E76\u91CD\u542F DSH \u540E\u624D\u5141\u8BB8\u5F00\u542F\u2014\u2014\u5426\u5219 browser_run \u53EA\u4F1A\u62A5\u9519\u3002"
};
var PROBE_API_VERSION = 2;
function InstallSummary({ probe, probing, error, installing, note, onCheck, onInstall }) {
  const mismatched = probe !== null && probe !== void 0 && probe.apiVersion !== PROBE_API_VERSION;
  const checks = Array.isArray(probe?.checks) ? probe.checks : [];
  const ok = probe?.ok === true;
  const tone = probe === null ? "neutral" : mismatched ? "danger" : ok ? "ok" : "danger";
  const title = probing ? "\u6B63\u5728\u68C0\u67E5\u6D4F\u89C8\u5668\u73AF\u5883\u2026" : probe === null ? "\u8FD8\u6CA1\u6709\u68C0\u67E5\u8FC7\u6D4F\u89C8\u5668\u73AF\u5883" : mismatched ? "\u5B89\u88C5\u81EA\u68C0\u9700\u8981\u91CD\u542F DSH" : String(probe.title ?? (ok ? "\u6D4F\u89C8\u5668\u73AF\u5883\u5C31\u7EEA" : "\u6D4F\u89C8\u5668\u73AF\u5883\u4E0D\u5B8C\u6574"));
  const needsCheck = probe === null || mismatched || !ok;
  const buttonLabel = probing ? "\u68C0\u67E5\u4E2D\u2026" : needsCheck ? "\u68C0\u67E5\u5B89\u88C5" : "\u5DF2\u5B89\u88C5";
  const buttonDisabled = probing || !needsCheck;
  return /* @__PURE__ */ __dshReact.createElement("section", { className: "ab-summary", "data-tone": tone }, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-summaryHead" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-dot", "data-dot": tone }), /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-summaryTitle" }, title), /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-summaryAction" }, /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      className: "ab-button",
      "data-variant": "primary",
      disabled: buttonDisabled,
      title: needsCheck ? "\u68C0\u67E5\u672C\u673A\u7684 agent-browser \u4E0E Chrome" : "\u73AF\u5883\u5DF2\u5C31\u7EEA\uFF0C\u65E0\u9700\u68C0\u67E5",
      onClick: onCheck
    },
    buttonLabel
  ))), mismatched ? /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-note" }, "\u5BA2\u6237\u7AEF\u534A\u5DF2\u662F\u65B0\u7248\u672C\uFF0C\u4F46 host \u534A\u8FD8\u662F\u65E7\u4EE3\u7801\uFF08Node \u6A21\u5757\u53EA\u5728\u542F\u52A8\u65F6\u52A0\u8F7D\uFF09\u3002\u91CD\u542F DSH \u540E\u81EA\u68C0\u5373\u53EF\u6B63\u5E38\u663E\u793A\u3002") : null, !mismatched && checks.length === 0 && probe !== null ? /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-note" }, "\u81EA\u68C0\u6CA1\u6709\u8FD4\u56DE\u4EFB\u4F55\u68C0\u67E5\u9879\u3002") : null, (mismatched ? [] : checks).map((check) => /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-check", key: String(check.id), "data-status": check.status }, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-checkHead" }, /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-checkMark", "aria-hidden": "true" }, check.status === "pass" ? "\u2713" : "\u2717"), /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-checkLabel" }, String(check.label ?? check.id)), /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-checkMessage" }, String(check.message ?? "")), check.status === "fail" && check.installable === true ? /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-checkAction" }, /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      className: "ab-button",
      "data-variant": "primary",
      disabled: installing,
      onClick: () => onInstall("cli")
    },
    installing ? "\u5B89\u88C5\u4E2D\u2026" : "\u5B89\u88C5"
  )) : null), check.status === "fail" && check.fix !== void 0 ? /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-checkFix" }, "\u4FEE\u6CD5\uFF1A", check.fix) : null)), note === "" ? null : /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-note" }, note), error === "" ? null : /* @__PURE__ */ __dshReact.createElement("p", { className: "ab-error", role: "alert" }, error));
}
function Row({ title, subtitle, control }) {
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-row" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowText" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowTitle" }, title), /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowSubtitle" }, subtitle)), /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowControl" }, control));
}
function Switch({ primitives: primitives2, label, checked, disabled, onChange }) {
  if (primitives2?.Switch !== void 0) {
    return /* @__PURE__ */ __dshReact.createElement(primitives2.Switch, { label, checked, disabled, onChange });
  }
  return /* @__PURE__ */ __dshReact.createElement(
    "input",
    {
      type: "checkbox",
      "aria-label": label,
      checked,
      disabled,
      onChange: (event) => onChange(event.target.checked)
    }
  );
}
function NumberStepper({ primitives: primitives2, value, min, max, step = 1, unit, disabled, editable = false, arrows = true, onChange }) {
  const Up = primitives2?.IconChevronUpOutlineRegular;
  const Down = primitives2?.IconChevronDownOutlineRegular;
  const [draft, setDraft] = (0, import_react3.useState)(String(value));
  (0, import_react3.useEffect)(() => {
    setDraft(String(value));
  }, [value]);
  function commitDraft() {
    const parsed = Number.parseInt(draft.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setDraft(String(next));
    if (next !== value) onChange(next);
  }
  return /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-stepper", "data-disabled": disabled === true, "data-editable": editable, "data-arrows": arrows }, editable ? /* @__PURE__ */ __dshReact.createElement(
    "input",
    {
      className: "ab-stepperInput",
      value: draft,
      inputMode: "numeric",
      "aria-label": `${unit}\u6570`,
      disabled: disabled === true,
      onChange: (event) => setDraft(event.target.value),
      onBlur: commitDraft,
      onKeyDown: (event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }
    }
  ) : /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-stepperValue" }, value), arrows ? /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-stepperArrows" }, /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      className: "ab-stepperArrow",
      "aria-label": `\u589E\u52A0${unit}`,
      disabled: disabled === true || value >= max,
      onMouseDown: (event) => event.preventDefault(),
      onClick: () => onChange(Math.min(max, value + step))
    },
    Up === void 0 ? "\u25B2" : /* @__PURE__ */ __dshReact.createElement(Up, { size: 9 })
  ), /* @__PURE__ */ __dshReact.createElement(
    "button",
    {
      type: "button",
      className: "ab-stepperArrow",
      "aria-label": `\u51CF\u5C11${unit}`,
      disabled: disabled === true || value <= min,
      onMouseDown: (event) => event.preventDefault(),
      onClick: () => onChange(Math.max(min, value - step))
    },
    Down === void 0 ? "\u25BC" : /* @__PURE__ */ __dshReact.createElement(Down, { size: 9 })
  )) : null), /* @__PURE__ */ __dshReact.createElement("span", { className: "ab-stepperUnit" }, unit));
}
var IDLE_PRESETS = [
  { value: "", label: "CLI \u9ED8\u8BA4\uFF081 \u5C0F\u65F6\uFF09" },
  { value: "10m", label: "10 \u5206\u949F" },
  { value: "30m", label: "30 \u5206\u949F" },
  { value: "1h", label: "1 \u5C0F\u65F6" },
  { value: "2h", label: "2 \u5C0F\u65F6" }
];
var IDLE_PRESET_MS = { "": 36e5, "10m": 6e5, "30m": 18e5, "1h": 36e5, "2h": 72e5 };
var IDLE_CUSTOM = "__custom__";
function IdleTimeoutControl({ primitives: primitives2, value, disabled, onChange }) {
  const isPreset = value === "" || IDLE_PRESETS.some((preset) => preset.value === value);
  const selectValue = isPreset ? value : IDLE_CUSTOM;
  const ms = isPreset ? IDLE_PRESET_MS[value] ?? 36e5 : Number(value) || 36e5;
  return /* @__PURE__ */ __dshReact.createElement(__dshReact.Fragment, null, /* @__PURE__ */ __dshReact.createElement(
    "select",
    {
      className: "ab-select",
      value: selectValue,
      disabled,
      "aria-label": "\u7A7A\u95F2\u8D85\u65F6\u9884\u8BBE",
      onChange: (event) => {
        const next = event.target.value;
        onChange(next === IDLE_CUSTOM ? String(IDLE_PRESET_MS[value] ?? ms) : next);
      }
    },
    IDLE_PRESETS.map((preset) => /* @__PURE__ */ __dshReact.createElement("option", { key: preset.value, value: preset.value }, preset.label)),
    /* @__PURE__ */ __dshReact.createElement("option", { value: IDLE_CUSTOM }, "\u81EA\u5B9A\u4E49\u2026")
  ), selectValue === IDLE_CUSTOM ? /* @__PURE__ */ __dshReact.createElement(
    NumberStepper,
    {
      primitives: primitives2,
      arrows: false,
      value: ms,
      min: 0,
      max: 864e5,
      step: 1e3,
      unit: "\u6BEB\u79D2",
      editable: true,
      disabled,
      onChange: (next) => onChange(String(next))
    }
  ) : null);
}
function StackedRow({ title, subtitle, control }) {
  return /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-row ab-rowStacked" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowText" }, /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowTitle" }, title), /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowSubtitle" }, subtitle)), /* @__PURE__ */ __dshReact.createElement("div", { className: "ab-rowControl ab-rowControlFull" }, control));
}
function TextArea({ value, placeholder, rows, disabled, onCommit }) {
  const [draft, setDraft] = (0, import_react3.useState)(String(value));
  (0, import_react3.useEffect)(() => {
    setDraft(String(value));
  }, [value]);
  return /* @__PURE__ */ __dshReact.createElement(
    "textarea",
    {
      className: "ab-textarea",
      value: draft,
      placeholder,
      rows,
      disabled,
      onChange: (event) => setDraft(event.target.value),
      onBlur: () => {
        if (draft !== String(value)) onCommit(draft);
      }
    }
  );
}
function TextField({ value, placeholder, disabled, onCommit }) {
  const [draft, setDraft] = (0, import_react3.useState)(String(value));
  (0, import_react3.useEffect)(() => {
    setDraft(String(value));
  }, [value]);
  return /* @__PURE__ */ __dshReact.createElement(
    "input",
    {
      className: "ab-input",
      value: draft,
      placeholder,
      disabled,
      onChange: (event) => setDraft(event.target.value),
      onBlur: () => {
        if (draft !== String(value)) onCommit(draft);
      },
      onKeyDown: (event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }
    }
  );
}

// client/index.jsx
var inject = ["slots", "configForms", "remote"];
async function apply(ctx) {
  const { form, entryId } = findForm(ctx);
  let browser;
  try {
    await ctx.remote.$mount(browserContribution());
  } catch (error) {
    console.warn("[agent-browser] Remote $mount \u5931\u8D25\uFF0C\u5B89\u88C5\u81EA\u68C0\u5C06\u4E0D\u53EF\u7528\uFF1A", error);
  }
  try {
    browser = ctx.get("remote.browser");
  } catch (error) {
    browser = void 0;
    console.warn("[agent-browser] \u53D6 remote.browser \u5931\u8D25\uFF0C\u5B89\u88C5\u81EA\u68C0\u5C06\u4E0D\u53EF\u7528\uFF1A", error);
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    // 排在「通用」(10) 与「决策」(21) 之后。
    id: "browser",
    order: 22,
    label: () => "\u6D4F\u89C8\u5668",
    inject: () => ({ form, entryId, primitives, browser })
  }, Panel));
}
return module.exports; } });
