/** Compile TypeScript/JSX sources for node:test without changing plain JS modules. */
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

/**
 * Sources keep the emitted specifier in their imports (`./x.js`, `./y.jsx`) while the
 * repository only ships `.ts` / `.tsx`; map each spelling to the extensions it may
 * resolve to before giving up.
 */
const REWRITES = Object.freeze([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
])

async function exists(url) {
  try {
    await access(fileURLToPath(url))
    return true
  } catch {
    return false
  }
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    const rewrite = REWRITES.find(([suffix]) => specifier.endsWith(suffix))
    if (rewrite === undefined) throw error
    const [suffix, extensions] = rewrite
    const base = new URL(specifier, context.parentURL)
    const stem = base.href.slice(0, -suffix.length)
    for (const extension of extensions) {
      const candidate = new URL(`${stem}${extension}`)
      if (await exists(candidate)) return { url: candidate.href, format: 'module', shortCircuit: true }
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  const extension = /\.(ts|tsx|jsx)$/.exec(url)?.[0]
  if (extension === undefined) return nextLoad(url, context)
  const source = await readFile(new URL(url))
  const { code } = await transform(source, {
    // `.tsx` uses the same factory the client bundle compiles to, so a component
    // behaves identically under node:test and on the panel.
    loader: extension === '.ts' ? 'ts' : extension === '.tsx' ? 'tsx' : 'jsx',
    jsx: 'transform',
    jsxFactory: '__dshReact.createElement',
    jsxFragment: '__dshReact.Fragment',
    format: 'esm',
    target: 'node20',
    sourcefile: url,
  })
  return { format: 'module', source: code, shortCircuit: true }
}
