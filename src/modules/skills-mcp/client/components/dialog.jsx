import { confirmDialog } from '../../../../client/ui/confirm-dialog.jsx'

/** The panel owns receipt handling and whether confirmation closes immediately. */
export function deleteConfirmDialog({ dialog, primitives, onCancel, onConfirm, pending = false, error = '' }) {
  if (dialog === null || dialog === undefined) return null
  return confirmDialog({
    primitives,
    title: `删除「${dialog.label}」？`,
    onCancel,
    onConfirm,
    pending,
    description: (
      <div className="smp-deleteMeta" key="meta">
        <div key="note">{dialog.note}</div>
        {error !== '' ? <div className="smp-error" key="err" style={{ marginTop: 6 }}>{error}</div> : null}
        {pending ? <div className="smp-pendingHint" key="pending">正在删除并刷新列表…</div> : null}
      </div>
    ),
  })
}
