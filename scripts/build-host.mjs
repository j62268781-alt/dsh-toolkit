/** Compile TypeScript without bundling and mirror module-owned runtime assets. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** Map paths to the slash form used as keys, so Windows and POSIX agree. */
const toSlash = (path) => path.split(sep).join('/')

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

export async function collectHostOutputs() {
  const outputs = new Map()
  // The emit program is deliberately looser than `tsconfig.json`: every module host
  // directory must compile here, while the strict program only covers the modules
  // that have finished their typing pass. Module-specific strictness is tracked in
  // `tsconfig.json`'s `include`, so a module graduates by moving into that list.
  const configPath = join(ROOT, 'tsconfig.build.json')
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, ROOT)
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: false })
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length) {
    const sample = ts.formatDiagnostics(diagnostics.slice(0, 20), {
      getCanonicalFileName: (path) => path, getCurrentDirectory: () => ROOT, getNewLine: () => '\n',
    })
    throw new Error(`${diagnostics.length} TypeScript diagnostics in the host emit program:\n${sample}`)
  }
  const emitted = program.emit(undefined, (path, contents) => outputs.set(toSlash(relative(ROOT, path)), contents))
  if (emitted.emitSkipped) throw new Error('TypeScript host emit was skipped')

  const copy = async (path) => outputs.set(`lib/${toSlash(relative(join(ROOT, 'src'), path))}`, await readFile(path))
  for (const path of await walk(join(ROOT, 'src/host'))) {
    // `.ts` sources are emitted by the program above; copying them would ship
    // TypeScript into lib/ next to the compiled JavaScript.
    if (!path.endsWith('.ts')) await copy(path)
  }
  for (const entry of await readdir(join(ROOT, 'src/modules'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const path of await walk(join(ROOT, 'src/modules', entry.name, 'host'))) {
      if (!path.endsWith('.ts')) await copy(path)
    }
  }

  return outputs
}

export async function buildHost({ check = false } = {}) {
  const outputs = await collectHostOutputs()
  // Catch removed/renamed sources rather than silently shipping stale host modules.
  for (const path of await walk(join(ROOT, 'lib'))) {
    const local = toSlash(relative(join(ROOT, 'lib'), path))
    if (local === 'client.js' || /^modules\/[^/]+\/client\.js$/.test(local) || local === '.build-manifest.json') continue
    if (!outputs.has(`lib/${local}`)) throw new Error(`Unexpected generated host file: lib/${local}; remove the stale output explicitly`)
  }
  for (const [path, content] of outputs) {
    const absolute = resolve(ROOT, path)
    if (check) {
      const current = await readFile(absolute).catch(() => Buffer.alloc(0))
      if (!current.equals(Buffer.from(content))) throw new Error(`${path} is stale; run pnpm build`)
    } else {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, content)
    }
  }
  console.log(`Host ${check ? 'checked' : 'built'}: ${outputs.size} files, unbundled services and runtime assets`)
  return outputs
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildHost({ check: process.argv.includes('--check') })
}
