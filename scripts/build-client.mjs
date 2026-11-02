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

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const SRC_JSX = resolve(ROOT, "src/client/index.jsx");
const SRC_CSS = resolve(ROOT, "src/client/styles.css");
const OUT_JS = resolve(ROOT, "lib/client.js");

const PLACEHOLDER = "__CLIENT_CSS__";

const BANNER = `/**
 * dsh-shell-kit — 客户端产物，由 scripts/build-client.mjs 生成，请勿手改。
 * 源码：src/client/index.jsx + src/client/styles.css
 */
`;

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
  const [source, css] = await Promise.all([readFile(SRC_JSX, "utf8"), readFile(SRC_CSS, "utf8")]);

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
