/**
 * dsh-shell-kit — 客户端产物构建（JSX + CSS → 单文件经典脚本）。
 *
 * ── 为什么需要这一步 ────────────────────────────────────────────────────
 *
 * DSH 把客户端插件当**经典脚本**求值：它只认 `window.__ModuleLoader__.load({
 * id, factory })` 这一种形状，不做任何转译，也不能相对 import。所以源码里
 * 的 JSX 必须在构建期编译掉，CSS 也必须在构建期内联成字符串常量。
 *
 * ── 为什么是「只转译、不打包」──────────────────────────────────────────
 *
 * 产物必须保留 `factory(require) { ... }` 外壳，`require("react")` 也得留着 ——
 * React 由宿主注入，打进产物会变成两份实例，也违反 bundle purity。所以用
 * esbuild 的 **transform**（不是 build）：只把 JSX 变成 `React.createElement(…)`
 * 调用，不解析模块、不引入任何 import。
 *
 * `jsxFactory: "React.createElement"` + `jsxFragment: "React.Fragment"` 和模块级
 * 的 `let React` 配合：React 在 factory 里由宿主赋值，JSX 生成的调用在渲染时
 * 才执行，那时 React 已经在位。
 *
 * ── CSS ─────────────────────────────────────────────────────────────────
 *
 * CSS 单独放在 `src/client/styles.css`，构建时经占位符 `__CLIENT_CSS__` 内联。
 * 内联而不是运行时 fetch：DSH 给插件注入的 `<style>` 打 `data-plugin` 并在卸载
 * 时清理，内联正好走这条既有通道，也不会出现首屏无样式闪烁。
 *
 * 用法：
 *   node scripts/build-client.mjs          # 写 lib/client.js
 *   node scripts/build-client.mjs --check  # 只校验产物是否与源码同步（CI 用）
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// 源码按「片段」组织：把片段按下面的清单顺序原样拼接，再整体转译。
// 之所以是拼接而不是 ES 模块：DSH 把客户端插件当经典脚本求值（只认
// `__ModuleLoader__.load({ factory })`），不能有 import/export。
//
// 顺序**显式写在这里**而不是靠文件名前缀排序：顺序是有语义的（core 要先定义
// PKG/CSS/React，entry 必须在最后注册模块；CSS 后面压前面），写在清单里一眼可见，
// 文件名也能叫得自然。目录里多出未列入清单的文件会直接构建失败（见 readParts）。
const JS_PARTS_DIR = resolve(ROOT, "modules/shell/shell-src/parts");
const CSS_PARTS_DIR = resolve(ROOT, "modules/shell/shell-src/styles");
const ASSETS_DIR = resolve(ROOT, "modules/shell/shell-src/assets");
const OUT_JS = resolve(ROOT, "lib/client.js");

/** JS 片段的拼接顺序（执行顺序）。 */
const JS_PARTS = ["core.jsx", "rail.jsx", "band.jsx", "sidebar.jsx", "archived.jsx", "entry.jsx"];

/** CSS 片段的拼接顺序（层叠顺序：后者压前者）。 */
const CSS_PARTS = ["tokens.css", "shell.css", "sidebar.css", "rightbar.css", "archived.css"];

const PLACEHOLDER = "__CLIENT_CSS__";

const BANNER = `/**
 * dsh-shell-kit — 客户端产物，由 scripts/build-client.mjs 生成，请勿手改。
 * 源码：src/client/parts/ + src/client/styles/（拼接顺序见构建脚本里的清单）
 */
`;

/**
 * 按清单顺序拼接片段，并做行尾归一化（保证同一份源码在任何平台产出同一字节流）。
 *
 * 清单与目录双向校验，因为「漏拼」是静默 bug：文件在那儿、构建也成功，
 * 只是那段代码没进产物。宁可构建失败。
 *
 * @param {string} dir 片段目录
 * @param {string[]} names 拼接顺序
 * @param {string} ext 后缀（含点）
 * @returns {Promise<string>} 拼接后的文本
 */
async function readParts(dir, names, ext) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(ext));
  const unlisted = files.filter((name) => !names.includes(name));
  const missing = names.filter((name) => !files.includes(name));
  if (unlisted.length > 0) {
    throw new Error(`${dir} 里有未列入清单的 ${ext} 文件：${unlisted.join(", ")}（要么加进清单，要么删掉）`);
  }
  if (missing.length > 0) {
    throw new Error(`${dir} 清单里的文件不存在：${missing.join(", ")}`);
  }
  const parts = await Promise.all(names.map((name) => readFile(join(dir, name), "utf8")));
  return parts.join("").replace(/\r\n/g, "\n");
}

/**
 * 读 `src/client/assets/*.svg`，key 是去掉后缀的文件名。
 *
 * SVG 放在独立文件里只是为了「能编辑、能预览」，**运行时形态不变**：
 * 构建期再内联回字符串（JS 用字符串字面量、CSS 用 data-URI），所以产物的
 * 请求数、缓存行为、`mask-image` 写法都和提取前完全一致。
 *
 * @returns {Promise<Map<string, string>>} 资源表
 */
async function readAssets() {
  let names = [];
  try {
    names = (await readdir(ASSETS_DIR)).filter((name) => name.endsWith(".svg")).sort();
  } catch {
    return new Map(); // 没有 assets 目录也允许
  }
  const entries = await Promise.all(
    names.map(async (name) => [
      name.replace(/\.svg$/, ""),
      (await readFile(join(ASSETS_DIR, name), "utf8")).trim(),
    ]),
  );
  return new Map(entries);
}

/**
 * data-URI 编码：只转义会破坏 CSS `url()` 的三个字符，其余原样保留 ——
 * 与仓库里既有的那条 `mask-image` 写法保持同一套规则。
 *
 * @param {string} svg 原始 SVG 文本
 * @returns {string} 可直接放进 `url("…")` 的 data-URI
 */
function svgToDataUri(svg) {
  const encoded = svg
    .replace(/\n\s*/g, "")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/#/g, "%23");
  return `data:image/svg+xml,${encoded}`;
}

/**
 * 把源码里的资源占位符换成真实内容。
 *
 *   JS ：`const HOUSE_SVG = "__SVG:house__";`  → 替换成 SVG 的字符串字面量
 *   CSS：`mask-image: url("__SVGURI:folder__")` → 替换成 data-URI
 *
 * 占位符本身是合法 JS/CSS（就是个字符串），所以源码在编辑器里不会报错。
 */
function inlineAssets(source, css, assets) {
  const need = (name, where) => {
    const text = assets.get(name);
    if (text === undefined) throw new Error(`${where} 引用了不存在的资源 ${name}.svg`);
    return text;
  };
  const nextSource = source.replace(/"__SVG:([\w.-]+)__"/g, (_m, name) =>
    JSON.stringify(need(name, "JS")),
  );
  const nextCss = css.replace(/__SVGURI:([\w.-]+)__/g, (_m, name) => svgToDataUri(need(name, "CSS")));
  return { source: nextSource, css: nextCss };
}

/**
 * 取 esbuild。
 *
 * 安装方（git / link 依赖）拿到的是仓库里已提交的 `lib/client.js`，不需要
 * esbuild；只有改源码的人才要装。所以用动态 import，并在缺失时给一条能看懂
 * 的提示，而不是一条 ERR_MODULE_NOT_FOUND 栈。
 */
async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    // 同一台机器上的兄弟插件（dsh-sidebar-mobile）装了 esbuild，借来用
    try {
      const fallback = resolve(ROOT, "../dsh-sidebar-mobile/node_modules/esbuild/lib/main.js");
      return await import(fallback);
    } catch {
      throw new Error("缺少 esbuild。装一次即可：npm i -D esbuild（本仓库唯一的 devDependency）");
    }
  }
}

/**
 * 生成产物文本。
 *
 * @returns {Promise<string>} lib/client.js 的完整内容
 */
async function render() {
  const [rawSource, rawCss, assets] = await Promise.all([
    readParts(JS_PARTS_DIR, JS_PARTS, ".jsx"),
    readParts(CSS_PARTS_DIR, CSS_PARTS, ".css"),
    readAssets(),
  ]);
  const { source, css } = inlineAssets(rawSource, rawCss, assets);

  if (!source.includes(PLACEHOLDER)) {
    throw new Error(`源码里找不到 CSS 占位符 ${PLACEHOLDER}`);
  }

  const esbuild = await loadEsbuild();
  const result = await esbuild.transform(source, {
    loader: "jsx",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    minify: false,
    // esbuild 默认 charset 是 ascii，会把每个非 ASCII 字符转成 \uXXXX，
    // 中文注释/文案会变成一坨转义。显式 utf8。
    charset: "utf8",
    format: "esm",
    target: "es2022",
    legalComments: "none",
  });

  for (const warning of result.warnings) console.warn("warning:", warning.text);

  const compiled = result.code.replace(PLACEHOLDER, () => JSON.stringify(css));
  return BANNER + compiled;
}

async function main() {
  const check = process.argv.includes("--check");
  const next = await render();

  if (check) {
    let current = "";
    try {
      current = await readFile(OUT_JS, "utf8");
    } catch {
      current = "";
    }
    if (current !== next) {
      console.error("lib/client.js 与源码不同步，请运行 node scripts/build-client.mjs");
      process.exit(1);
    }
    console.log("lib/client.js 已与源码同步");
    return;
  }

  await mkdir(dirname(OUT_JS), { recursive: true });
  await writeFile(OUT_JS, next, "utf8");
  console.log(`已写入 ${OUT_JS.replace(ROOT + "/", "")}（${Buffer.byteLength(next)} 字节）`);
}

await main();
