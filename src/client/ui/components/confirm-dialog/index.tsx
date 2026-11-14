/**
 * 跨模块的确认弹窗：只负责外壳（宿主 Modal + 标题/说明/页脚），确认按钮与业务
 * 副作用由调用方给。
 *
 * 为什么是宿主 Modal 而不是自己的 `<div>`：插件页「添加插件」那个弹窗就是它，标题
 * 16px/24px/500、说明 14px/22px/400、圆角 `--dsw-radius-panel`、遮罩与进出场动画
 * 全部由它带，深浅色主题和 codex 皮肤也自动跟随。自己画一个只会逐像素对不上。
 *
 * - `description` / `children` 都收 ReactNode：调用方常把「说明 + 错误行」拼在一起。
 * - `confirmButton` 用于危险操作（红色删除按钮自带 loading / 图标），不给就用宿主的
 *   黑色 primary 按钮 —— 那是宿主自己的「确认」样式。
 */

export interface ConfirmDialogOptions {
  /** 宿主 primitives 表；拿不到 `Modal` 时返回 null（模块自己决定降级）。 */
  primitives?: any
  title?: string
  /** 子标题：Modal 的 `.description`（14px/22px）。 */
  description?: any
  /** 额外正文：错误行、补充说明，渲染在 `.body` 里。 */
  children?: any
  onCancel?: () => void
  onConfirm?: () => void
  pending?: boolean
  /** 模块自己的确认按钮（通常是危险操作），传了就完全接管页脚右侧。 */
  confirmButton?: any
  closeLabel?: string
  cancelLabel?: string
  confirmLabel?: string
  pendingLabel?: string
}

export function confirmDialog({
  primitives,
  title,
  description,
  children,
  onCancel,
  onConfirm,
  pending = false,
  confirmButton,
  closeLabel = '关闭',
  cancelLabel = '取消',
  confirmLabel = '删除',
  pendingLabel = '删除中…',
}: ConfirmDialogOptions): any {
  const Modal = primitives?.Modal
  if (Modal === undefined) return null
  const Button = primitives.Button ?? 'button'
  const confirm = confirmButton ?? (
    <Button variant="primary" key="ok" onClick={onConfirm} disabled={pending}>
      {pending ? pendingLabel : confirmLabel}
    </Button>
  )
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
          {confirm}
        </>
      }
    >
      {children}
    </Modal>
  )
}
