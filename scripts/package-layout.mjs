/** Build-time identities only; package manifests and wrappers remain hand-maintained. */
import { access } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Source order the build probes for an extension-less entry.
 *
 * Modules migrate to TypeScript one at a time, so the layout names an entry without
 * an extension and the build picks whichever form currently exists.
 */
export const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx'])

/** Resolve `base` against the probe order; throws instead of guessing when none exists. */
export async function resolveSourceEntry(root, base) {
  for (const extension of SOURCE_EXTENSIONS) {
    const path = join(root, `${base}${extension}`)
    try {
      await access(path)
      return path
    } catch {}
  }
  throw new Error(`No source entry for ${base} (tried ${SOURCE_EXTENSIONS.join(', ')})`)
}

export const PACKAGE_MODULES = Object.freeze([
  { name: 'boot', client: { entry: 'src/modules/boot/client/index', factory: false }, skills: [] },
  { name: 'theme', client: { entry: 'src/modules/theme/client/index', factory: false }, skills: [] },
  { name: 'archived', client: { entry: 'src/modules/archived/client/index', factory: false }, skills: [] },
  { name: 'browser', client: { entry: 'src/modules/browser/client/index', factory: false }, skills: ['agent-browser'] },
  { name: 'judgment', client: { entry: 'src/modules/judgment/client/index', factory: false }, skills: [] },
  { name: 'mobile', client: { entry: 'src/modules/mobile/client/index', factory: true }, skills: ['mobilecli'] },
  { name: 'skills-mcp', client: { entry: 'src/modules/skills-mcp/client/client', factory: true }, skills: [] },
  { name: 'notification', client: { entry: 'src/modules/notification/client/index', factory: true }, skills: [] },
  { name: 'pet', client: { entry: 'src/modules/pet/client/index', factory: true }, skills: [] },
  { name: 'hooks', client: { entry: 'src/modules/hooks/client/index', factory: false }, skills: [] },
  { name: 'remote', client: { entry: 'src/modules/remote/client/index', factory: true }, skills: [] },
].map((module) => Object.freeze({ ...module, packageName: `dsh-toolkit-${module.name}` })))
