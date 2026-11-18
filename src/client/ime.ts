/**
 * 输入法组字期间不要响应 Enter。
 *
 * 组字中的 Enter 是「确认候选」，此刻 keydown 的 `key` 仍是字面字符（拼音、假名），
 * 直接当快捷键用就等于拿一个还没确认的拼音去提交 —— 建分支会建出乱码名字、
 * 短信验证码框会把半截拼音发出去、改名会改成 `zhongwen`。
 *
 * 两个判据都要有：`isComposing` 是标准信号，而 Safari 在组字确认那一次只报
 * `keyCode: 229`（VK_PROCESSKEY）不报 13，只有第一个判据会漏掉它。
 * React 合成事件不保证带 `isComposing`，所以优先读 `nativeEvent`。
 */
export function isComposingEvent(event: any): boolean {
  const native = event?.nativeEvent ?? event
  return native?.isComposing === true || native?.keyCode === 229
}
