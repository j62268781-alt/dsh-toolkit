/** Compile JSX in the retained upstream tests without changing plain JS modules. */
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.jsx')) return nextLoad(url, context)
  const source = await readFile(new URL(url), 'utf8')
  const { code } = await transform(source, {
    loader: 'jsx',
    jsx: 'transform',
    jsxFactory: '__dshReact.createElement',
    jsxFragment: '__dshReact.Fragment',
    format: 'esm',
    target: 'node20',
    sourcefile: url,
  })
  return { format: 'module', source: code, shortCircuit: true }
}
