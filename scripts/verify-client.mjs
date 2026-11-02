/**
 * dsh-shell-kit — 产物自检（契约 + 平台分支）
 *
 * 为什么需要它：皮肤靠「语义锚点 + 局部名子串」去命中 DSH 的组件，这些锚点
 * 是稳定的，但**不是不会变的**。DSH 升级后如果某个锚点改名，样式只会静默
 * 失效（不报错、不白屏），靠人眼发现很晚。这个脚本把「本皮肤依赖的关键事实」
 * 变成断言：
 *
 *   1) 门禁统一：产物里不能残留旧的双条件门禁，必须是 data-sk-desktop；
 *   2) 平台变量：darwin / windows 两组都存在，且 windows 组在 darwin 组之后
 *      （同权重时后者胜出，顺序错了 Windows 会拿不到自己的值）；
 *   3) 几何不写死：macOS 专属的 88px / 160px / 84px 必须已经变量化；
 *   4) rail 居中前提：_panelList 内边距为 0（居中靠行自身的 margin:auto）；
 *   5) Windows 结构分支：rail-only 只藏 _brand、保留 _logoRow（折叠钮在
 *      _logoRow 里，藏父节点会让按钮消失）；macOS 专用热区在 Windows 关闭；
 *   6) JS 谓词：isDesktokShell / isDarwinDesktop / installDesktopMarker 以及
 *      data-sk-desktop 常量都在产物里，且没有残留「只认 darwin」的提前 return。
 *
 * 用法：
 *   node scripts/verify-client.mjs            # 默认校验 lib/client.js
 *   node scripts/verify-client.mjs <产物路径>
 */

import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "lib/client.js";
const built = readFileSync(file, "utf8");

// 产物里 `const CSS = "…"` 是被 JSON.stringify 内联的整张样式表
const match = built.match(/const CSS = ("(?:[^"\\]|\\.)*")/);
if (match === null) {
  console.error(`✗ ${file} 里找不到内联 CSS（构建产物格式变了？）`);
  process.exit(1);
}
const css = JSON.parse(match[1]);

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

/* ── 1) 门禁统一 ─────────────────────────────────────────────────────── */
const oldGate = ':is(html[data-platform="darwin"], html:has([class*="_topStrip"]))';
check("旧的双条件门禁已清零", !css.includes(oldGate), `仍有 ${css.split(oldGate).length - 1} 处`);
check(
  "统一门禁 html[data-sk-desktop] 存在",
  css.includes("html[data-sk-desktop]"),
  `${css.split("html[data-sk-desktop]").length - 1} 处`,
);

/* ── 2) 平台变量组与层叠顺序 ─────────────────────────────────────────── */
const darwinAt = css.indexOf('html[data-platform="darwin"] body');
const windowsAt = css.indexOf("html[data-windows-titlebar] body");
check("darwin 变量组存在", darwinAt >= 0);
check("windows 变量组存在", windowsAt >= 0);
check("windows 组在 darwin 组之后", windowsAt > darwinAt, `darwin@${darwinAt} windows@${windowsAt}`);

if (windowsAt >= 0) {
  const block = css.slice(windowsAt, css.indexOf("}", windowsAt));
  for (const [name, value] of [
    ["--cx-band-h", "0px"],
    ["--cx-toggle-x", "12px"],
    ["--cx-title-clear", "0px"],
    ["--cx-title-clear-full", "0px"],
  ]) {
    check(`windows: ${name} = ${value}`, block.includes(`${name}: ${value}`));
  }
  check(
    "windows: --cx-rail 与原生 titlebar 同色",
    block.includes("--cx-rail: var(--dsw-specific-sidebar-fill)"),
  );
  check(
    "windows: 原生中央列圆角归零（不裁掉皮肤卡片圆角）",
    block.includes("--dsh-windows-content-radius: 0px"),
  );
}

/* ── 3) macOS 专属几何必须变量化 ─────────────────────────────────────── */
const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, "");
check("规则里没有硬编码 left: 88px", !/left:\s*88px/.test(rulesOnly));
check("规则里没有硬编码 clearance: 160px", !/leading-clearance:\s*160px/.test(rulesOnly));
check("规则里没有硬编码 clearance: 84px", !/leading-clearance:\s*84px/.test(rulesOnly));

/* ── 4) rail 居中的前提 ──────────────────────────────────────────────── */
const listRule = rulesOnly.match(/\[data-slot="sidebar"\][^{]*?\[class\*="_panelList"\]\s*\{([^}]*)\}/);
check(
  "_panelList 内边距为 0（居中只靠 margin:auto）",
  listRule !== null && /padding:\s*0;/.test(listRule[1]),
  listRule === null ? "未命中规则" : listRule[1].replace(/\s+/g, " ").trim(),
);

/* ── 5) Windows 结构分支 ─────────────────────────────────────────────── */
check(
  "windows: rail-only 用 display:flex 保留 _logoRow",
  /html\[data-windows-titlebar\][\s\S]{0,220}?_logoRow"\]\s*\{[^}]*display:\s*flex/.test(rulesOnly),
);
check(
  "windows: rail-only 只隐藏 _brand",
  /html\[data-windows-titlebar\][\s\S]{0,320}?_logoRow"\]\s*>\s*\[class\*="_brand"\]\s*\{[^}]*display:\s*none/.test(
    rulesOnly,
  ),
);
check(
  "windows: macOS 专用折叠热区已关闭",
  /html\[data-windows-titlebar\]\s+\.sk-collapse-hit\s*\{[^}]*display:\s*none/.test(rulesOnly),
);

/* ── 6) JS 侧谓词 ────────────────────────────────────────────────────── */
check("产物含 isDesktopShell()", built.includes("function isDesktopShell()"));
check("产物含 isDarwinDesktop()", built.includes("function isDarwinDesktop()"));
check("产物含 installDesktopMarker()", built.includes("function installDesktopMarker()"));
check('产物含标记常量 "data-sk-desktop"', built.includes('"data-sk-desktop"'));
check(
  "产物没有残留「只认 darwin」的提前 return",
  !built.includes('getAttribute("data-platform") !== "darwin") return'),
);
check(
  "折叠钮用结构识别（class 局部名 _toggle），不依赖 aria-label 文案",
  built.includes('includes("_toggle")'),
);
check(
  "展开态用状态观察（data-sidebar-collapsed），不靠点按钮猜",
  built.includes("data-sidebar-collapsed") && built.includes("MutationObserver"),
);

/* ── 汇总 ────────────────────────────────────────────────────────────── */
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok || r.detail === "" ? "" : `  ← ${r.detail}`}`);
  if (!r.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} 通过（${file}）`);
process.exit(failed === 0 ? 0 : 1);
