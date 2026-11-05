export const PET_NS = 'dsh-toolkit.pet'
export const PET_COPY = {
  zh: {
    nav: '桌面宠物', title: '桌面宠物', intro: '选择宠物形象，分别开启桌面悬浮和屏幕顶部的灵动岛。',
    appearance: '宠物形象', refresh: '刷新列表', identity: '当前形象', identityDesc: '桌面悬浮与灵动岛共用此形象，切换后同时更新。', missingPet: '所选形象不可用', emptyPets: '暂无可用形象',
    desktop: '桌面悬浮', petEnabled: '显示悬浮宠物', petEnabledDesc: '在桌面上显示宠物，可拖动位置。', petSize: '宠物大小', petSizeDesc: '只调整悬浮宠物的大小，不影响灵动岛。', bubbleWidth: '会话气泡宽度', bubbleWidthDesc: '调整悬浮宠物上方的会话气泡宽度。',
    screenTop: '屏幕顶部', islandEnabled: '显示灵动岛', islandEnabledDesc: '在屏幕顶部查看会话进展、回复消息和打开工作台。可独立于悬浮宠物开启。', islandIdle: '空闲时显示', islandIdleDesc: '没有会话活动时，仍显示宠物和问候。点击可打开工作台。', islandAllDisplays: '在其他显示器上显示', islandAllDisplaysDesc: '连接多个显示器时，在各屏幕顶部同步显示灵动岛。',
    islandSize: '灵动岛大小', islandSizeDesc: '调整收起时的宽度和高度，不影响展开内容。有刘海的屏幕，高度不会小于刘海。', restore: '恢复默认大小', builtIn: '内置显示器', external: '外接显示器', width: '宽度', height: '高度', preview: '收起状态尺寸预览',
    runtime: '桌面运行时', runtimeUnknown: '正在读取桌面运行时状态…', runtimeUnavailable: '首次使用需要准备桌面运行时。', runtimeStopped: '已就绪，开启桌宠或灵动岛后自动启动。', runtimeStarting: '正在准备或启动桌面运行时…', runtimeRunning: '桌面运行时正在运行。', runtimeError: '桌面运行时启动失败。', prepare: '准备桌面运行时', retry: '重试', start: '启动',
    readOnly: '宿主没有提供可写的配置表单，设置仅供查看。', failed: '操作失败：{reason}', reconnecting: '桌面状态连接已中断，正在重新连接。',
  },
  en: {
    nav: 'Desktop pet', title: 'Desktop pet', intro: 'Choose a pet and independently enable the floating pet and the island at the top of your screen.',
    appearance: 'Pet appearance', refresh: 'Refresh list', identity: 'Current appearance', identityDesc: 'The floating pet and island share this appearance and update together.', missingPet: 'Selected appearance unavailable', emptyPets: 'No appearances available',
    desktop: 'Floating desktop pet', petEnabled: 'Show floating pet', petEnabledDesc: 'Show a pet on your desktop. Drag it to move it.', petSize: 'Pet size', petSizeDesc: 'Resize the floating pet without changing the island.', bubbleWidth: 'Conversation bubble width', bubbleWidthDesc: 'Adjust the width of the conversation bubble above the pet.',
    screenTop: 'Top of screen', islandEnabled: 'Show island', islandEnabledDesc: 'See session progress, reply to messages, and open your workspace. Works independently of the floating pet.', islandIdle: 'Show when idle', islandIdleDesc: 'Keep the pet and greeting visible without session activity. Click to open the workspace.', islandAllDisplays: 'Show on other displays', islandAllDisplaysDesc: 'Show the island at the top of every connected display.',
    islandSize: 'Island size', islandSizeDesc: 'Adjust the collapsed width and height without changing expanded content. Height stays at least as tall as a display notch.', restore: 'Restore default size', builtIn: 'Built-in display', external: 'External display', width: 'Width', height: 'Height', preview: 'Collapsed size preview',
    runtime: 'Desktop runtime', runtimeUnknown: 'Reading desktop runtime status…', runtimeUnavailable: 'Prepare the desktop runtime before first use.', runtimeStopped: 'Ready. Enabling the pet or island starts it automatically.', runtimeStarting: 'Preparing or starting the desktop runtime…', runtimeRunning: 'Desktop runtime is running.', runtimeError: 'The desktop runtime failed to start.', prepare: 'Prepare desktop runtime', retry: 'Retry', start: 'Start',
    readOnly: 'The host exposes no writable configuration form. These settings are read-only.', failed: 'Action failed: {reason}', reconnecting: 'Desktop status disconnected. Reconnecting…',
  },
}
export function createTranslator(ctx) {
  let bound
  try { bound = ctx.locale?.bind?.(PET_NS) } catch {}
  return (key, params = {}) => {
    let language
    try { language = ctx.locale?.language ?? ctx.locale?.getLanguage?.() ?? ctx.locale?.lang } catch {}
    const dict = PET_COPY[String(language ?? 'zh').startsWith('en') ? 'en' : 'zh']
    let value
    try { value = bound?.(key) } catch {}
    if (typeof value !== 'string' || !value || value === key) value = dict[key] ?? key
    return value.replace(/\{(\w+)\}/g, (match, name) => params[name] == null ? match : String(params[name]))
  }
}
