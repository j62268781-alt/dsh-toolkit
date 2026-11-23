import { isHttpUrl, MAX_SOURCE_LENGTH } from '../constants.js'
import { baseName, dirName, normalizePath, type ClassifiedSeed } from './classify.js'

type Fields = Record<string, unknown>

function fields(value: unknown): Fields | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sourceOf(message: unknown): Fields | undefined {
  const data = fields(message)
  return data?.role === 'user' ? fields(data.source) : undefined
}

function isDirectInput(message: unknown): boolean {
  return sourceOf(message)?.kind === 'user'
}

function referencesOf(message: unknown): Fields[] {
  const source = sourceOf(message)
  if (source?.kind !== 'session-reference' || source.form !== 'recall' || source.version !== 1
    || !Array.isArray(source.references)) return []
  return source.references.flatMap((reference: unknown) => {
    const data = fields(reference)
    return data && text(data.sessionId) !== '' ? [data] : []
  })
}

function inputPath(raw: string, quoted: boolean): string {
  // Web composer ships @file as ordinary text. Without a quote, require a path-shaped
  // token instead of treating every @name as a workspace file.
  if (raw === '' || raw.length > MAX_SOURCE_LENGTH || /[\u0000-\u001f\u007f-\u009f"@<>|]/u.test(raw)
    || /^[a-z][a-z0-9+.-]*:(?![/\\])/iu.test(raw) || raw.includes('://')) return ''
  if (!quoted && !/[/\\]|\.[\p{L}\p{N}_-]|^[A-Z][A-Z0-9_-]+$|^[A-Z][a-z]+file$/u.test(raw)) return ''
  return normalizePath(raw)
}

function trimUrl(raw: string): string {
  // Strip prose/Markdown delimiters without stripping balanced parentheses in the URL.
  let url = raw.replace(/[.,;:!?，。；：！？]+$/u, '')
  const opens = url.split('(').length
  let closes = url.split(')').length
  while (url.endsWith(')') && closes > opens) {
    url = url.slice(0, -1)
    closes--
  }
  return url
}

function* textSources(value: string, recallLabels: readonly string[]): Iterable<ClassifiedSeed> {
  // DSH serializes quote chips as Markdown blockquotes, not independent sources.
  let input = value.replace(/^ {0,3}>[^\r\n]*/gmu, '')
  for (const label of recallLabels) {
    const literal = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    input = input.replace(new RegExp(`@${literal}(?=[，。；：！？、]|[.,;:!?)\\]]*(?:$|\\s))`, 'gu'), ' ')
  }
  for (const token of input.matchAll(/(?<!\S)@(?:"([^"\r\n]+)"|([^"\s，。；：！？、]+))|(?<![\p{L}\p{N}_:/=])https?:\/\/[^\s<>"'`，。；：！？、]+/giu)) {
    const raw = token[1] ?? token[2]?.replace(/[.,;:!?，。；：！？]+$/u, '')
    if (raw !== undefined) {
      const target = inputPath(raw, token[1] !== undefined)
      if (target === '') continue
      const label = baseName(target.replace(/\/$/u, '')) || target
      yield { kind: 'source', id: `input:file:${target}`, label, detail: dirName(target), target }
      continue
    }
    const target = trimUrl(token[0])
    if (target.length <= MAX_SOURCE_LENGTH && isHttpUrl(target)) {
      yield { kind: 'source', id: `input:url:${target}`, label: target, detail: '', target }
    }
  }
}

/** Collect sources from a consumed user input and the optional recall directly after it. */
export function collectInputSources(message: unknown, recall?: unknown): ClassifiedSeed[] {
  const seeds = new Map<string, ClassifiedSeed>()
  const references = referencesOf(recall)
  const content = fields(message)?.content
  if (isDirectInput(message) && Array.isArray(content)) {
    const labels = references.map(reference => text(reference.label) || text(reference.sessionId)).sort((a, b) => b.length - a.length)
    for (const block of content) {
      const part = fields(block)
      if (part?.type === 'text' && typeof part.text === 'string') {
        for (const seed of textSources(part.text, labels)) seeds.set(seed.id, seed)
      } else if (part?.type === 'file' || part?.type === 'image') {
        const attachment = fields(part.attachment)
        const id = text(attachment?.attachmentId)
        if (id === '') continue
        const name = text(attachment?.name)
        const mediaType = text(attachment?.mediaType)
        // Attachment IDs are opaque: the existing panel can open paths and URLs, not these IDs.
        const seedId = `input:attachment:${part.type}:${id}`
        seeds.set(seedId, { kind: 'source', id: seedId, label: name || mediaType || id, detail: '' })
      }
    }
  }
  for (const reference of references) {
    const sessionId = text(reference.sessionId)
    const id = `input:session:${sessionId}`
    seeds.set(id, { kind: 'source', id, label: text(reference.label) || sessionId, detail: '' })
  }
  return [...seeds.values()]
}

/** Observe newly consumed input, without reading or replaying session history. */
export function observeInputSources(record: (sessionId: string, seeds: ClassifiedSeed[]) => void) {
  const pending = new WeakMap<object, { seq: unknown; message: unknown; recall?: unknown }>()
  return (session: unknown, event: unknown): void => {
    const entry = fields(event)
    if (entry?.type !== 'user/message') return
    const owner = fields(session)
    const sessionId = fields(owner?.header)?.id
    if (owner === undefined || typeof sessionId !== 'string' || sessionId === '') return
    if (!isDirectInput(entry.data)) {
      const direct = pending.get(owner)
      if (typeof direct?.seq === 'number' && entry.seq === direct.seq + 1 && referencesOf(entry.data).length > 0) {
        direct.recall = entry.data
      }
      return
    }
    const direct: { seq: unknown; message: unknown; recall?: unknown } = { seq: entry.seq, message: entry.data }
    pending.set(owner, direct)
    // DSH synchronously appends the recall right after its direct message. Wait for
    // it so flattened @session labels don't look like files or links in the input.
    queueMicrotask(() => {
      if (pending.get(owner) === direct) pending.delete(owner)
      const seeds = collectInputSources(direct.message, direct.recall)
      if (seeds.length > 0) record(sessionId, seeds)
    })
  }
}
