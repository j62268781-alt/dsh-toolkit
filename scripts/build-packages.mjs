/** Emit standalone packages while preserving the root lib/ compatibility build. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { collectHostOutputs } from './build-host.mjs'
import { collectPackageClientOutputs } from './build-client.mjs'
import { PACKAGE_MODULES } from './package-layout.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const textOf = (content) => Buffer.from(content).toString('utf8')

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })) {
    if (entry.name === '.DS_Store') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

/** Parse real dependency nodes, excluding comments and import-shaped strings. */
function dependencies(path, content) {
  const source = ts.createSourceFile(path, textOf(content), ts.ScriptTarget.Latest, true)
  const found = []
  const add = (node, typeOnly = false) => {
    if (node && ts.isStringLiteralLike(node) && node.text.startsWith('.')) found.push({ specifier: node.text, typeOnly })
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier, source.isDeclarationFile || node.importClause?.isTypeOnly === true)
    else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, source.isDeclarationFile || node.isTypeOnly)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal, true)
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      add(node.arguments[0], source.isDeclarationFile)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function resolveDependency(owner, dependency, hostOutputs) {
  const target = posix.normalize(posix.join(posix.dirname(owner), dependency.specifier))
  const declaration = target.replace(/\.(?:mjs|cjs|js)$/, '.d.ts')
  const candidates = dependency.typeOnly
    ? [declaration, `${target}.d.ts`, posix.join(target, 'index.d.ts'), target]
    : [target, `${target}.js`, posix.join(target, 'index.js')]
  const resolved = candidates.find((candidate) => hostOutputs.has(candidate))
  if (!resolved || !resolved.startsWith('lib/')) {
    throw new Error(`Standalone package dependency is missing or escapes lib/: ${owner} -> ${dependency.specifier}`)
  }
  return resolved
}

/** Keep compiler maps useful after extraction without relying on repository source files. */
async function portableMap(path, content) {
  const map = JSON.parse(textOf(content))
  if (!Array.isArray(map.sources)) return content
  const sources = map.sources.map((source) => posix.normalize(posix.join(posix.dirname(path), map.sourceRoot ?? '', source)))
  map.sourcesContent = await Promise.all(sources.map(async (source, index) => {
    if (map.sourcesContent?.[index] !== undefined) return map.sourcesContent[index]
    if (!source.startsWith('src/')) throw new Error(`Source map escapes source tree: ${path} -> ${source}`)
    return readFile(resolve(ROOT, source), 'utf8')
  }))
  map.sources = sources.map((source) => `toolkit:///${source}`)
  delete map.sourceRoot
  return `${JSON.stringify(map)}\n`
}

/** A module's own Host tree plus only the shared/type dependency closure it imports. */
export async function collectPackageHostOutputs(hostOutputs = undefined) {
  hostOutputs ??= await collectHostOutputs()
  const outputs = new Map()
  for (const module of PACKAGE_MODULES) {
    const prefix = `lib/modules/${module.name}/host/`
    const included = new Set()
    const queue = [...hostOutputs.keys()].filter((path) => path.startsWith(prefix)).sort()
    // Wrappers may declare shared helpers outside their own Host tree.
    const wrapper = await readFile(join(ROOT, 'packages', module.name, 'index.js'), 'utf8')
    for (const dependency of dependencies('index.js', wrapper)) {
      if (!dependency.specifier.startsWith('./lib/')) {
        throw new Error(`Package wrapper must import its own ./lib/: packages/${module.name}/index.js -> ${dependency.specifier}`)
      }
      queue.push(resolveDependency('index.js', dependency, hostOutputs))
    }
    while (queue.length) {
      const path = queue.shift()
      if (included.has(path)) continue
      included.add(path)
      const content = hostOutputs.get(path)
      if (content === undefined) throw new Error(`Missing generated Host dependency: ${path}`)
      if (/\.(?:js|mjs|cjs|ts)$/.test(path)) {
        for (const dependency of dependencies(path, content)) queue.push(resolveDependency(path, dependency, hostOutputs))
        // Preserve declaration faces and maps only for included implementation/type files.
        for (const companion of [`${path}.map`, path.replace(/\.js$/, '.d.ts')]) {
          if (companion !== path && hostOutputs.has(companion)) queue.push(companion)
        }
      }
    }
    for (const path of [...included].sort()) {
      const content = hostOutputs.get(path)
      outputs.set(`packages/${module.name}/${path}`, path.endsWith('.map') ? await portableMap(path, content) : content)
    }
    for (const skill of module.skills) {
      const source = join(ROOT, 'skills', skill)
      for (const path of await walk(source)) {
        const relative = path.slice(source.length + 1).replaceAll('\\', '/')
        outputs.set(`packages/${module.name}/skills/${skill}/${relative}`, await readFile(path))
      }
    }
  }
  return outputs
}

/** --check compares every expected byte and rejects unexpected generated files. */
export async function buildPackages({ check = false, hostOutputs } = {}) {
  const outputs = await collectPackageHostOutputs(hostOutputs)
  for (const [path, content] of await collectPackageClientOutputs()) outputs.set(path, content)
  // These are wholly generated directories, so stale files are errors rather than shipped baggage.
  for (const module of PACKAGE_MODULES) {
    const packageRoot = join(ROOT, 'packages', module.name)
    for (const directory of ['lib', 'skills']) {
      for (const path of await walk(join(packageRoot, directory))) {
        const relative = path.slice(ROOT.length).replaceAll('\\', '/')
        if (!outputs.has(relative)) throw new Error(`Unexpected generated package file: ${relative}; remove the stale output explicitly`)
      }
    }
  }
  for (const [path, content] of [...outputs].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const absolute = resolve(ROOT, path)
    if (check) {
      const current = await readFile(absolute).catch((error) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!current || !current.equals(Buffer.from(content))) throw new Error(`${path} is stale; run pnpm build`)
    } else {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, content)
    }
  }
  console.log(`Packages ${check ? 'checked' : 'built'}: ${PACKAGE_MODULES.length} standalone modules, ${outputs.size} files`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPackages({ check: process.argv.includes('--check') })
}
