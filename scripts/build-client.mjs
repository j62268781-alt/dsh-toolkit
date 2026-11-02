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

// 源码按「片段」组织：目录内按文件名排序后原样拼接，再整体转译。
// 之所以是拼接而不是 ES 模块：DSH 把客户端插件当经典脚本求值（只认
// `__ModuleLoader__.load({ factory })`），不能有 import/export。片段名前面的
// 两位数字就是拼接顺序，文件本身没有任何 import。
const JS_PARTS_DIR = resolve(ROOT, "src/client/parts");
const CSS_PARTS_DIR = resolve(ROOT, "src/client/styles");
const ASSETS_DIR = resolve(ROOT, "src/client/assets");
const OUT_JS = resolve(ROOT, "lib/client.js");

const PLACEHOLDER = "__CLIENT_CSS__";

const BANNER = `/**
 * dsh-shell-kit — 客户端产物，由 scripts/build-client.mjs 生成，请勿手改。
 * 源码：src/client/parts/*.jsx（按文件名排序拼接）+ src/client/styles/*.css
 */
`;

/**
 * 读一个目录里指定后缀的所有片段，按文件名排序后拼接。
 *
 * 排序即层叠/执行顺序，所以片段名统一用 `NN-` 前缀。拼接后再做行尾归一化，
 * 保证同一份源码在 Windows / macOS 上产出同一个字节流。
 *
 * @param {string} dir 片段目录
 * @param {string} ext 后缀（含点）
 * @returns {Promise<string>} 拼接后的文本
 */
async function readConcat(dir, ext) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(ext)).sort();
  if (names.length === 0) throw new Error(`${dir} 下没有 ${ext} 片段`);
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
    readConcat(JS_PARTS_DIR, ".jsx"),
    readConcat(CSS_PARTS_DIR, ".css"),
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
