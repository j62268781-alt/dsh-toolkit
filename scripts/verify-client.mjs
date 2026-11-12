/** Verify the theme's DSH selectors, platform branches, and geometry contracts. */

import { readFileSync } from "node:fs";
import ts from "typescript";

const file = process.argv[2] ?? "lib/client.js";
const built = readFileSync(file, "utf8");

// esbuild 可改写声明和引号；读取字符串字面量，不执行客户端代码。
const source = ts.createSourceFile(file, built, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let css;
const stringLiterals = new Set();
const visit = (node) => {
  if (ts.isStringLiteralLike(node)) stringLiterals.add(node.text);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "THEME_CSS"
      && node.initializer && ts.isStringLiteralLike(node.initializer) && css === undefined) {
    css = node.initializer.text;
  }
  ts.forEachChild(node, visit);
};
visit(source);
if (css === undefined) {
  console.error(`✗ ${file} 里找不到内联 CSS（构建产物格式变了？）`);
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

/* ── 1) 门禁统一 ─────────────────────────────────────────────────────── */
const oldGate = ':is(html[data-platform="darwin"], html:has([class*="_topStrip"]))';
check("旧的双条件门禁已清零", !css.includes(oldGate), `仍有 ${css.split(oldGate).length - 1} 处`);
check(
  '统一门禁 html[data-sk-palette="codex"][data-sk-codex-shell] 存在',
  css.includes('html[data-sk-palette="codex"][data-sk-codex-shell]'),
  `${css.split('html[data-sk-palette="codex"][data-sk-codex-shell]').length - 1} 处`,
);

/* ── 2) 平台变量组与层叠顺序 ─────────────────────────────────────────── */
const darwinAt = css.indexOf('html[data-sk-palette="codex"][data-platform="darwin"] body');
const windowsAt = css.indexOf('html[data-sk-palette="codex"][data-windows-titlebar] body');
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
  /html\[data-sk-palette="codex"\]\[data-windows-titlebar\][\s\S]{0,220}?_logoRow"\]\s*\{[^}]*display:\s*flex/.test(rulesOnly),
);
check(
  "windows: rail-only 只隐藏 _brand",
  /html\[data-sk-palette="codex"\]\[data-windows-titlebar\][\s\S]{0,320}?_logoRow"\]\s*>\s*\[class\*="_brand"\]\s*\{[^}]*display:\s*none/.test(
    rulesOnly,
  ),
);
check(
  "windows: macOS 专用折叠热区已关闭",
  /html\[data-sk-palette="codex"\]\[data-windows-titlebar\]\s+\.sk-collapse-hit\s*\{[^}]*display:\s*none/.test(rulesOnly),
);

/* ── 6) JS 侧谓词 ────────────────────────────────────────────────────── */
check("产物含 isDesktopShell()", built.includes("function isDesktopShell()"));
check("产物含 isDarwinDesktop()", built.includes("function isDarwinDesktop()"));
check("产物含 installShellMarkers()", built.includes("function installShellMarkers()"));
check('产物含标记常量 "data-sk-desktop"', built.includes('"data-sk-desktop"'));
check('产物含标记常量 "data-sk-codex-shell"', built.includes('"data-sk-codex-shell"'));
check("产物含宽屏阈值 SHELL_MIN_WIDTH = 1024", /SHELL_MIN_WIDTH = 1024/.test(built));
check(
  "产物没有残留「只认 darwin」的提前 return",
  !built.includes('getAttribute("data-platform") !== "darwin") return'),
);
check(
  "折叠钮只匹配侧边栏顶部结构，不拦截页面中的其他 _toggle",
  [...stringLiterals].some((value) => value.startsWith('[data-slot="sidebar"] > ')
    && value.includes('[class*="_topStrip"]') && value.includes('[class*="_logoRow"]')
    && value.endsWith('button[class*="_toggle"]'))
    && !built.includes('includes("_toggle")'),
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
