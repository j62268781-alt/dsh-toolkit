/** Build one classic DSH client script and module harnesses from ESM sources. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'
import { PACKAGE_MODULES, resolveSourceEntry } from './package-layout.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const THEME = join(ROOT, 'src/modules/theme/client')

async function themeCss(path) {
  const source = await readFile(path, 'utf8')
  const imports = [...source.matchAll(/@import\s+"([^"]+)"\s*;/g)]
  let css = source
  for (const match of imports) {
    css = css.replace(match[0], () => '')
  }
  const parts = await Promise.all(imports.map((match) => themeCss(resolve(dirname(path), match[1]))))
  return [...parts, css].join('\n').replace(/\r\n/g, '\n')
}

function sourcePlugin() {
  return {
    name: 'toolkit-client-assets',
    setup(build) {
      build.onLoad({ filter: /[/\\]theme[/\\]client[/\\]styles\.css$/ }, async ({ path }) => {
        let css = await themeCss(path)
        const names = [...new Set([...css.matchAll(/__SVGURI:([\w.-]+)__/g)].map((match) => match[1]))]
        for (const name of names) {
          const svg = (await readFile(join(THEME, 'assets', `${name}.svg`), 'utf8')).trim()
          const uri = `data:image/svg+xml,${svg.replace(/\n\s*/g, '').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}`
          css = css.replaceAll(`__SVGURI:${name}__`, uri)
        }
        return { contents: `const THEME_CSS = ${JSON.stringify(css)}; export default THEME_CSS;`, loader: 'js' }
      })
      build.onLoad({ filter: /[/\\]theme[/\\]client[/\\]assets[/\\][^/\\]+\.svg$/ }, async ({ path }) => ({
        contents: `export default ${JSON.stringify((await readFile(path, 'utf8')).trim())};`, loader: 'js',
      }))
      // The archived half is the only one whose JSX targets the React instance it imports
      // itself (its own bundle is also loaded outside the aggregate client harness).
      build.onLoad({ filter: /[/\\]archived[/\\]client[/\\].*\.(?:jsx|tsx)$/ }, async ({ path }) => ({
        contents: (await transform(await readFile(path, 'utf8'), {
          loader: path.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
          format: 'esm', target: 'es2022', charset: 'utf8', legalComments: 'none',
        })).code,
        loader: 'js',
      }))
      build.onLoad({ filter: /[/\\]mobile[/\\]client[/\\].*\.(?:jsx|tsx)$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        let { code } = await transform(source, {
          loader: path.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm',
          target: 'es2022', charset: 'utf8', legalComments: 'none',
        })
        // Only the entry inlines the panel CSS; the placeholder check keeps that contract visible.
        if (dirname(path) === join(ROOT, 'src/modules/mobile/client') && /^index\.(?:jsx|tsx)$/.test(basename(path))) {
          if (!code.includes('__CLIENT_CSS__')) throw new Error('Missing mobile CSS placeholder')
          const css = (await readFile(join(dirname(path), 'styles.css'), 'utf8')).replace(/\r\n/g, '\n')
          code = code.replace('__CLIENT_CSS__', () => JSON.stringify(css))
        }
        return { contents: code.replace(/\/\* @__PURE__ \*\/\s*/g, ''), loader: 'js' }
      })
    },
  }
}

const clients = [
  ['theme', 'dsh-toolkit/theme', 'src/modules/theme/client/index', false],
  ['archived', 'dsh-toolkit/archived', 'src/modules/archived/client/index', false],
  ['browser', '@j62268781-alt/dsh-agent-browser', 'src/modules/browser/client/index', false],
  ['judgment', 'dsh-judgment', 'src/modules/judgment/client/index', false],
  ['mobile', '@j62268781-alt/dsh-sidebar-mobile', 'src/modules/mobile/client/index', true],
  ['skills-mcp', '@j62268781-alt/dsh-skills-mcp-manager', 'src/modules/skills-mcp/client/client', true],
  ['boot', 'dsh-toolkit/boot', 'src/modules/boot/client/index', false],
]

/** Import specifier for an extension-less entry, resolved through the probe order. */
async function entrySpecifier(base) {
  const path = relative(ROOT, await resolveSourceEntry(ROOT, base)).split(sep).join('/')
  return `./${path}`
}

async function bundle(entry, id, plugin) {
  const result = await build({
    absWorkingDir: ROOT, ...entry, bundle: true, write: false, platform: 'browser',
    format: 'cjs', target: 'es2022', charset: 'utf8', legalComments: 'none',
    // 只把宿主提供的模块留作 external：react 与 primitives 由宿主的模块表解析。
    minify: false, external: ['react', 'react/*', '@deepseek-ai/*'],
    jsxFactory: '__dshReact.createElement', jsxFragment: '__dshReact.Fragment',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.ts': 'ts', '.tsx': 'tsx', '.css': 'text', '.html': 'text' }, plugins: [plugin],
  })
  const code = result.outputFiles[0].text
  return `/** Generated by scripts/build-client.mjs; edit src/ instead. */\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(id)},\n  factory(require) {\n    const module = { exports: {} };\n${code.split('\n').map((line) => line ? `    ${line}` : '').join('\n')}\n    return module.exports;\n  },\n});\n`
}

/** Build the independently installable browser halves without touching legacy harness ids. */
export async function collectPackageClientOutputs() {
  const outputs = new Map()
  const plugin = sourcePlugin()
  for (const module of PACKAGE_MODULES) {
    if (!module.client) continue
    const path = await entrySpecifier(module.client.entry)
    const contents = module.client.factory
      ? `import createClient from ${JSON.stringify(path)}; module.exports = createClient(require);`
      : `export * from ${JSON.stringify(path)};`
    outputs.set(`packages/${module.name}/lib/client.js`, await bundle({
      stdin: { contents, resolveDir: ROOT, sourcefile: `${module.name}-package-entry.js` },
    }, module.packageName, plugin))
  }
  return outputs
}

export async function buildClient({ check = false } = {}) {
  const plugin = sourcePlugin()
  const outputs = new Map([
    ['lib/client.js', await bundle({ entryPoints: [await resolveSourceEntry(ROOT, 'src/client/index')] }, 'dsh-toolkit', plugin)],
  ])
  // Ignored bundles exercise the same sources with the original module harnesses.
  for (const [name, id, base, factory] of clients) {
    const path = await entrySpecifier(base)
    const contents = factory
      ? `import createClient from ${JSON.stringify(path)}; module.exports = createClient(require);`
      : `export * from ${JSON.stringify(path)};`
    outputs.set(`lib/modules/${name}/client.js`, await bundle({ stdin: { contents, resolveDir: ROOT, sourcefile: `${name}-test-entry.js` } }, id, plugin))
  }
  for (const [path, contents] of outputs) {
    const absolute = resolve(ROOT, path)
    if (check) {
      const current = await readFile(absolute, 'utf8').catch(() => '')
      if (current !== contents) throw new Error(`${path} is stale; run pnpm build`)
    } else {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, contents)
    }
  }
  console.log(`Client ${check ? 'checked' : 'built'}: one shared loader, ${outputs.size - 1} module test bundles`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildClient({ check: process.argv.includes('--check') })
}
