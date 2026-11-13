import './react.js'
import { confirmDialog } from '../../../client/ui/components/confirm-dialog/index.jsx'

/** The caller retains the dialog on failure and falls back to native confirm without Modal. */
export function ConfirmDialog({ dialog, primitives, onCancel, onConfirm, pending = false, error = '' }) {
  if (dialog === null || dialog === undefined) return null
  return confirmDialog({
    primitives,
    title: `删除${dialog.kind === 'connection' ? '连接' : '用途'}「${dialog.label}」？`,
    onCancel,
    onConfirm,
    pending,
    description: (
      <div className="jdg-deleteMeta">
        <div>{dialog.note}</div>
        {error !== '' ? <div className="jdg-error" style={{ marginTop: 6 }}>{error}</div> : null}
        {pending ? <div className="jdg-pendingHint">正在删除并刷新配置…</div> : null}
      </div>
    ),
  })
}
