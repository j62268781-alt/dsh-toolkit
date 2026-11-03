/** Project a module's existing settings form onto the toolkit's one Cordis row. */
export const ROOT_ENTRIES = ['shell-kit', 'dsh-toolkit', 'dsh-shell-kit']

const EMPTY = Object.freeze({})
const forms = new WeakMap()

export function scopeForm(form, namespace) {
  let namespaces = forms.get(form)
  if (!namespaces) forms.set(form, namespaces = new Map())
  if (namespaces.has(namespace)) return namespaces.get(namespace)

  let previous
  let projected
  const pathOf = (path) => [namespace, ...(Array.isArray(path) ? path : [path])]
  const getSnapshot = () => {
    const snapshot = form.getSnapshot?.() ?? form.store?.getSnapshot?.() ?? form.snapshot ?? EMPTY
    if (snapshot !== previous || projected === undefined) {
      previous = snapshot
      projected = snapshot !== null && typeof snapshot === 'object' && 'value' in snapshot
        ? { ...snapshot, value: snapshot.value?.[namespace] ?? EMPTY }
        : snapshot?.[namespace] ?? EMPTY
    }
    return projected
  }
  const subscribe = (listener) => {
    if (typeof form.subscribe === 'function') return form.subscribe(listener)
    return form.store?.subscribe?.(listener)
  }
  const scoped = { getSnapshot, subscribe }
  Object.defineProperty(scoped, 'snapshot', { get: getSnapshot })
  scoped.store = { getSnapshot, subscribe }
  for (const key of ['status', 'writable', 'revision']) {
    Object.defineProperty(scoped, key, { get: () => form[key] })
  }
  // ConfigForm.set accepts one scalar field, while mutate accepts a full path.
  if (typeof form.mutate === 'function') {
    scoped.set = (path, value, ...args) => form.mutate([{ op: 'set', path: pathOf(path), value }], ...args)
    scoped.unset = (path, ...args) => form.mutate([{ op: 'unset', path: pathOf(path) }], ...args)
    scoped.mutate = (operations, ...args) => form.mutate(operations.map((operation) => ({ ...operation, path: pathOf(operation.path ?? []) })), ...args)
  }
  namespaces.set(namespace, scoped)
  return scoped
}

/** Standalone entry fallbacks keep the upstream module harnesses usable. */
export function findScopedForm(ctx, namespace, legacyCandidates = []) {
  for (const entryId of [...ROOT_ENTRIES, ...legacyCandidates]) {
    try {
      const form = ctx?.configForms?.get?.(entryId)
      if (form) return { form: ROOT_ENTRIES.includes(entryId) ? scopeForm(form, namespace) : form, entryId }
    } catch {
      // Missing entries throw on some versions of the host.
    }
  }
  return { form: undefined, entryId: ROOT_ENTRIES[0] }
}
