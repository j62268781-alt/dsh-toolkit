/** Presentation only: callers own confirmation, pending state, and fallback policy. */

export interface ConfirmDialogOptions {
  primitives?: any
  title?: string
  description?: string
  onCancel?: () => void
  onConfirm?: () => void
  pending?: boolean
  closeLabel?: string
  cancelLabel?: string
  confirmLabel?: string
  pendingLabel?: string
}

export function confirmDialog({
  primitives,
  title,
  description,
  onCancel,
  onConfirm,
  pending = false,
  closeLabel = '关闭',
  cancelLabel = '取消',
  confirmLabel = '删除',
  pendingLabel = '删除中…',
}: ConfirmDialogOptions): any {
  const Modal = primitives?.Modal
  if (Modal === undefined) return null
  const Button = primitives.Button ?? 'button'
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      closeLabel={closeLabel}
      description={description}
      footer={
        <>
          <Button variant="outline" key="cancel" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
          <Button variant="primary" key="ok" onClick={onConfirm} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </>
      }
    />
  )
}
