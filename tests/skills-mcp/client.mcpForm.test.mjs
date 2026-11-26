/** 新增弹窗与现有行编辑：走真实面板交互并检查发给 Host 的行命令。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootPanel, emptyDoc, skipWithoutBundle, textOf, visit } from './helpers/client-harness.mjs'

const PROFILE_ROW = {
  entryId: 'include:mcp-existing', serverName: 'existing', transport: 'stdio',
  target: 'npx -y pkg', command: 'npx', args: '-y pkg', env: 'T=1',
  failOnStartupError: true, reconnectInitialDelayMs: '1000', reconnectMaxDelayMs: '60000', reconnectMaxAttempts: '60',
  toolCallTimeoutMs: '60000',
  enabled: true, phase: '',
}

const addModal = (panel) => panel.find((node) => node.props['data-modal'] === '添加服务器')

function openAddForm(panel) {
  panel.click(panel.byClass('smp-button', '添加服务器'))
  assert.ok(addModal(panel) !== null, '应打开宿主 Modal')
}

function footerButtons(panel) {
  let footer
  visit(panel.runtime.tree, (node) => {
    if (typeof node.type === 'function' && node.props.title === '添加服务器') footer = node.props.footer
  })
  return inside(footer, (node) => node.type === 'button')
}

function inside(node, predicate) {
  const matches = []
  visit(node, (element) => { if (typeof element.type === 'string' && predicate(element)) matches.push(element) })
  return matches
}

function disclosure(panel, label, placeholderPrefix) {
  const details = inside(addModal(panel), (node) => node.type === 'details')
  assert.equal(details.length, 1, '只展示当前传输类型的可选项')
  assert.ok(!details[0].props.open, '可选项默认收起')
  const summary = (details[0].children ?? []).flat().find(Boolean)
  assert.equal(summary?.type, 'summary', '原生 summary 应是 details 的首个子元素')
  assert.equal(textOf(summary).trim(), label)
  const textarea = inside(details[0], (node) => node.type === 'textarea'
    && String(node.props.placeholder ?? '').startsWith(placeholderPrefix))[0]
  assert.ok(textarea, '对应输入应在可选项内部')
  return textarea
}

/**
 * 三个 reconnect 数字输入，按渲染顺序（首次延迟 / 最大延迟 / 最大次数）。
 *
 * 不再按 placeholder 找：输入框现在**预填真实默认值**，placeholder 只是同一个数字，
 * 拿它当选择器会把"字段有值"和"字段是空的"混为一谈。
 */
/**
 * The three **reconnect** number inputs, in render order.
 *
 * 按 label 而不是按位置取：表单里还有 `toolCallTimeoutMs` 这个同样是 number 的顶层字段，
 * 而它排在 reconnection 三项**之前**（见 render 顺序）。按位置取会让每次新增字段都悄悄
 * 错位一格 —— 之前就是用一个"取全部 number 输入"的助手，加字段后第一个断言就挂了。
 */
const reconnectInputs = (panel) => panel
  .findAll((node) => node.type === 'input' && node.props.type === 'number')
  .slice(-3)

/** `toolCallTimeoutMs` 的输入框（number 字段里排在重连三项之前的那一个）。 */
const timeoutInput = (panel) => panel
  .findAll((node) => node.type === 'input' && node.props.type === 'number')
  .slice(0, -3)[0]

function assertShortForm(panel) {
  const policyInputs = inside(addModal(panel), (node) => node.props.role === 'switch'
    || (node.type === 'input' && ['checkbox', 'number'].includes(node.props.type)))
  assert.equal(policyInputs.length, 0, '新增不显示启动、连接与重连策略')
}

function assertAddDefaults(op) {
  assert.equal(op.op, 'add')
  assert.equal(op.lazy, true)
  assert.equal(op.singleMcpEntry, true)
  assert.notEqual(op.manualToolCache, true)
  assert.notEqual(op.allowInsecureTokenEndpoint, true)
  assert.notEqual(op.failOnStartupError, true)
  assert.deepEqual(
    [op.reconnectInitialDelayMs, op.reconnectMaxDelayMs, op.reconnectMaxAttempts, op.toolCallTimeoutMs],
    ['500', '30000', '10', '60000'],
    '精简表单后，发给 Host 的连接默认值不变',
  )
}

test('MCP 新增：stdio 预填 npx，发送参数和折叠区里的环境变量', { skip: skipWithoutBundle() }, async () => {
  const panel = await bootPanel(emptyDoc())
  try {
    openAddForm(panel)
    const transport = inside(addModal(panel), (node) => node.type === 'select'
      && node.props.value === 'streamable-http')[0]
    panel.change(transport, 'stdio')
    assertShortForm(panel)
    const command = panel.byPlaceholder('npx')
    assert.equal(command?.props.value, 'npx', '命令预填 npx，而不是仅显示占位符')
    assert.ok(panel.byPlaceholder('https://…/mcp') === null, 'stdio 不需要 URL')
    panel.change(panel.byPlaceholder('例如 test，最多 32 字符'), 'stdio-test')
    panel.change(panel.byPlaceholder('-y @scope/pkg@latest'), '-y @scope/pkg')
    panel.change(disclosure(panel, '环境变量', 'TEST_TOKEN='), 'TEST_TOKEN=example')
    panel.click(panel.byText('保存'))
    await panel.settle()

    const [op] = panel.doc.rowCommands ?? []
    assert.ok(op, '保存后没有把命令发给 Host')
    assertAddDefaults(op)
    assert.equal(op.transport, 'stdio')
    assert.equal(op.command, 'npx')
    assert.equal(op.args, '-y @scope/pkg')
    assert.equal(op.env, 'TEST_TOKEN=example')
  } finally {
    panel.restore()
  }
})

test('MCP 新增：HTTP 认证头在折叠区，保存命令直接发给 Host', { skip: skipWithoutBundle() }, async () => {
  const panel = await bootPanel(emptyDoc())
  const { doc, change, byPlaceholder, byText } = panel
  try {
    openAddForm(panel)
    assertShortForm(panel)
    change(byPlaceholder('例如 test，最多 32 字符'), 'github')
    change(byPlaceholder('https://…/mcp'), 'https://example.com/mcp')
    change(disclosure(panel, '认证请求头', 'Authorization='), 'Authorization=Bearer example')
    panel.click(byText('保存'))
    await panel.settle()

    const [op] = doc.rowCommands ?? []
    assert.ok(op, '保存后没有把命令发给 Host')
    assertAddDefaults(op)
    assert.equal(op.transport, 'streamable-http')
    assert.equal(op.serverName, 'github')
    assert.equal(op.url, 'https://example.com/mcp')
    assert.equal(op.headers, 'Authorization=Bearer example')
    assert.deepEqual(doc.rowOps ?? [], [], 'HTTP 成功后不该再写 rowOps')
  } finally {
    panel.restore()
  }
})

test('新增：Host 一确认就摘掉转圈，不等投影（写盘只要几毫秒）', { skip: skipWithoutBundle() }, async () => {
  /**
   * 命令经 HTTP 发出、Host 回 `{ok:true}` 时，写入就已经完成了。此时再显示
   * 「正在写入配置文件…」是在误报"还在写"——它以前要等到**投影**回来（面板下一次
   * 轮询，最长约 1.5 秒）才消失，而那段时间里用户看到的就是"转一会"。
   *
   * 卡片本身要留到投影列出该行为止（否则新增的卡片会先消失、再闪回来），所以这里同时
   * 钉住两件事：转圈没了，卡片还在。
   */
  const panel = await bootPanel(emptyDoc({ profileServers: [], rowOpsReady: true }))
  const cards = () => panel.findAll((node) => String(node.props?.className ?? '').split(/\s+/).includes('smp-card'))
    .map((node) => textOf(node).replace(/\s+/g, ' ').trim()).filter((text) => text.includes('brand'))
  try {
    openAddForm(panel)
    panel.change(panel.byPlaceholder('例如 test，最多 32 字符'), 'brand')
    panel.change(panel.byPlaceholder('https://…/mcp'), 'https://brand/mcp')
    const initialFooter = footerButtons(panel)
    assert.deepEqual(initialFooter.map((node) => textOf(node).trim()), ['取消', '保存'])
    panel.click(initialFooter[1])

    const pendingFooter = footerButtons(panel)
    assert.deepEqual(pendingFooter.map((node) => textOf(node).trim()), ['取消', '保存中…'])
    assert.equal(pendingFooter[1].props.disabled, true, '保存中不可再次提交')
    // 命令还没回来：乐观卡片已在，带转圈（这是诚实的"还在写"）
    assert.equal(cards().length, 1, '保存后应立刻出现乐观卡片')
    assert.match(cards()[0], /正在写入配置文件/, '命令未回时应有转圈')

    // Host 确认 → 转圈必须立刻消失，且卡片仍在
    await panel.settle()
    assert.equal(cards().length, 1, '确认后卡片不该消失（要等投影替换它）')
    assert.doesNotMatch(cards()[0], /正在写入配置文件/, 'Host 已确认，转圈必须摘掉')
    assert.ok(addModal(panel) === null, 'Host 确认后关闭弹窗')
  } finally {
    panel.restore()
  }
})

test('MCP 表单：编辑配置行时回填连接参数，且 command 不被 target 污染', { skip: skipWithoutBundle() }, async () => {
  const panel = await bootPanel(emptyDoc({ profileServers: [PROFILE_ROW], rowOpsReady: true }))
  const { doc, runtime, byText, find } = panel
  try {
    // 切到 MCP tab（默认就是），点该行的「…」→「编辑」
    panel.openMenu()
    panel.click(byText('编辑'))
    assert.ok(byText('保存到配置行') !== null, '没有进入配置行的编辑态')

    // 回填：三个数字来自行配置；command 是原始可执行文件，不是拼好的 target
    const values = reconnectInputs(panel).map((node) => node.props.value)
    assert.deepEqual(values, ['1000', '60000', '60'], `回填的数字不对：${JSON.stringify(values)}`)
    const commandInput = find((node) => node.type === 'input' && node.props.value === 'npx')
    assert.ok(commandInput !== null, 'command 没有回填成原始命令（可能被 target 污染）')

    // 没动过连接输入框 → op 里必须标记 connectionChanged: false（Host 会跳过它们）
    panel.click(byText('保存到配置行'))
    await panel.settle()
    let op = (doc.rowCommands ?? [])[0]
    assert.ok(op, '没有把命令发给 Host')
    assert.equal(op.op, 'update')
    assert.equal(op.connectionChanged, false, '没改过连接字段却标记成改动，会误删已有配置')
    doc.rowCommands = []

    assert.equal(op.command, 'npx', '保存时 command 被写成了拼好的 target')
    assert.equal(op.args, '-y pkg')
    assert.equal(op.failOnStartupError, true)
    assert.equal(op.reconnectInitialDelayMs, '1000')
    assert.equal(op.reconnectMaxAttempts, '60')
    assert.equal(op.reconnectMaxDelayMs, '60000')
    assert.equal(op.toolCallTimeoutMs, '60000', '顶层超时字段也要随命令带过去（PR #1）')

    // 真改了其中一个数字 → 标记成改动，Host 才会写。
    doc.rowCommands = []
    const settled = find((node) => String(node.props.className ?? '').includes('smp-card') && textOf(node).includes('existing'))
    assert.ok(settled !== null, '保存后找不到该行')
    runtime.render()
    panel.openMenu()
    panel.click(byText('编辑'))
    panel.change(reconnectInputs(panel)[2], '30')
    panel.click(byText('保存到配置行'))
    await panel.settle()
    op = (doc.rowCommands ?? [])[0]
    assert.equal(op.connectionChanged, true, '改了连接字段却没标记，值不会生效')
    assert.equal(op.reconnectMaxAttempts, '30')
    runtime.render()
  } finally {
    panel.restore()
  }
})

test('项目级编辑：回填连接字段，并作为**行操作**写入（不再改 config.servers）', { skip: skipWithoutBundle() }, async () => {
  /**
   * 项目级服务器现在也是 `mcp-client` 行，所以编辑走的是与全局完全相同的行操作管线。
   *
   * 这个用例以前断言「编辑后条目不会被挪到 config.servers 末尾」——那是数组原地替换的
   * 顾虑。行操作按 entryId 定位，本来就不会重排，所以真正的契约变成了两条：
   *   1. 表单要回填已配置的连接策略（空值会被当成「用户清空」而写坏）
   *   2. 保存必须产出一条指向该行的 rowOp，而不是去动插件自己的字段
   */
  const projectRow = (entryId, serverName, over = {}) => ({
    entryId, scope: '/p/tcl', serverName, transport: 'streamable-http',
    target: `http://x/mcp/${serverName}`, command: '', args: '', env: '', headersText: '',
    failOnStartupError: false, reconnectInitialDelayMs: '', reconnectMaxDelayMs: '',
    reconnectMaxAttempts: '', toolCallTimeoutMs: '', enabled: true, phase: 'active', ...over,
  })
  const gitnexus = projectRow('mcp-gitnexus', 'gitnexus', {
    failOnStartupError: true, reconnectInitialDelayMs: '1000', reconnectMaxDelayMs: '60000', reconnectMaxAttempts: '60',
  })
  const figma = projectRow('mcp-framelink-figma', 'framelink-figma')
  const panel = await bootPanel(emptyDoc({
    profileServers: [gitnexus, figma], currentWorkspace: '/p/tcl', rowOpsReady: true,
  }))
  const { doc, findAll, find, byText, change, restore } = panel
  try {
    // 每条都该有「…」触发器（编辑/删除收在里面）。开第一条的菜单再点编辑。
    const triggers = findAll((node) => String(node.props.className ?? '') === 'smp-moreTrigger')
    assert.ok(triggers.length >= 2, `项目级条目没渲染出操作菜单：${triggers.length}`)
    panel.openMenu(0)
    panel.click(byText('编辑'))

    // 回填：必须显示已配置的 1000 / 60000 / 60，而不是空（空会显示成 placeholder 500）
    // number 输入有 4 个（含顶层的 toolCallTimeoutMs），这里只关心重连三项
    const numbers = findAll((node) => node.type === 'input' && node.props.type === 'number')
      .slice(-3).map((n) => n.props.value)
    assert.deepEqual(numbers, ['1000', '60000', '60'], `连接字段没回填：${JSON.stringify(numbers)}`)

    change(reconnectInputs(panel)[0], '2000')
    // 编辑「行」的表单按钮文案是「保存到配置行」——与全局页签完全一致，因为两档同源
    panel.click(byText('保存到配置行'))

    // 契约：一条命令，指向这一行（走 HTTP，见文件头）
    await panel.settle()
    const ops = Array.isArray(doc.rowCommands) ? doc.rowCommands : []
    assert.equal(ops.length, 1, `应恰好发出一条命令：${JSON.stringify(ops)}`)
    assert.equal(ops[0].op, 'update')
    assert.equal(ops[0].entryId, 'mcp-gitnexus')
    assert.equal(ops[0].reconnectInitialDelayMs, '2000')
    assert.equal(ops[0].reconnectMaxAttempts, '60', '没碰的字段被清空了')
    assert.equal(ops[0].failOnStartupError, true, '没碰的勾选框被清空了')
    // 面板自己的配置字段不再是真相源：两档都只写行
    assert.deepEqual(doc.servers ?? [], [], '不该再往 config.servers 写东西')
  } finally {
    restore()
  }
})

test('MCP 编辑：保留按需启动设置及宿主开关结构', { skip: skipWithoutBundle() }, async () => {
  /**
   * 用户反馈：布尔设置用勾选框，且说明文字换行成两行时行距被挤在一起。
   *
   * 两个问题都来自同一处旧样式 `.smp-inlineCheck { height: 32px }` —— 固定高度对一行文字
   * 成立，两行 13px/18px 需要 36px，于是第二行被压在第一行上。这些说明几乎都是整句话，
   * 换行是常态而不是例外，所以固定高度是 bug，不是文字太长。
   *
   * 这条测试钉住**结构**：开关 + 独立文字列 + 独立的后果说明行。具体像素在 CSS 里，
   * 但「说明是不是一个独立元素」决定了它会不会和标题挤成一行 —— 那是可测的。
   */
  const panel = await bootPanel(emptyDoc({ profileServers: [{ ...PROFILE_ROW, lazy: true, failOnStartupError: false }] }))
  try {
    panel.openMenu()
    assert.doesNotMatch(panel.text(), /改为随 DSH 启动|改为按需启动/)
    panel.click(panel.byText('编辑'))
    assert.equal(panel.switchNamed('按需启动（懒加载）')?.props, undefined)
    const rows = panel.findAll((node) => String(node.props.className ?? '') === 'smp-switchRow')
    // 已有的懒加载行保留原值，不应用新增的合并入口默认值。
    for (const [label, enabled] of [
      ['手动更新工具清单', false],
      ['合并为单一 MCP 入口', false],
    ]) {
      assert.equal(panel.switchNamed(label)?.props['aria-checked'], enabled, label)
    }
    assert.equal(rows.length, 4)
    for (const row of rows) {
      const classes = (row.children ?? []).flat(3).filter((child) => child?.props).map((child) => String(child.props.className ?? ''))
      assert.ok(classes.some((name) => name === 'smp-switchSlot'), '开关行缺少开关槽位（决定了 flex 布局的是包装器，不是控件本身）')
      assert.ok(classes.some((name) => name === 'smp-switchRowText'), '开关行缺少文字列')
    }
    // 说明文字必须是**独立**的一行：拼进标题里会被当成名称的一部分而跳读。
    const hints = panel.findAll((node) => String(node.props.className ?? '') === 'smp-switchRowHint')
    assert.equal(hints.length, rows.length, '每个开关的说明应是独立元素')
    assert.match(textOf(hints.at(-1)), /明文/, '安全降级的后果说明必须写出来')

    /**
     * 两个开关分属不同概念（连接策略 / OAuth 安全），中间必须有一条分隔线。
     * 没有它时两块文字挨在一起，读起来像一个开关组里的两行，而不是两项独立设置。
     *
     * 同时钉住**位置**：分隔线要在第 1 个开关之后、第 2 个开关之前 —— 只在页面里
     * 存在一条线是看不出它到底隔开了什么的。
     */
    // 按渲染顺序收集两个关注点，再看它们谁先谁后 —— 位置断言比「存在」强，
    // 一条落在表单别处的分隔线同样能通过「存在」检查。
    const sequence = []
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return
      const cls = String(node.props?.className ?? '')
      if (cls === 'smp-switchRow') sequence.push('row')
      if (cls === 'smp-divider') sequence.push('divider')
      for (const child of Array.isArray(node.children) ? node.children : [node.children]) walk(child)
    }
    walk(panel.runtime.tree)
    assert.deepEqual(
      sequence,
      [...rows.slice(1).map(() => 'row'), 'divider', 'row'],
      `分隔线必须恰好落在连接策略与 OAuth 安全两个开关之间，实际顺序 ${JSON.stringify(sequence)}`,
    )
  } finally {
    panel.restore()
  }
})

test('MCP 编辑：可修改连接参数和明文 token 端点，保留未修改的策略', { skip: skipWithoutBundle() }, async () => {
  const row = { ...PROFILE_ROW, failOnStartupError: false }
  const panel = await bootPanel(emptyDoc({ profileServers: [row], rowOpsReady: true }))
  try {
    panel.openMenu()
    panel.click(panel.byText('编辑'))
    assert.equal(timeoutInput(panel).props.value, '60000')
    assert.equal(panel.switchNamed('连不上时拒绝激活（failOnStartupError）')?.props['aria-checked'], false)
    assert.equal(panel.switchNamed('允许明文 token 端点')?.props['aria-checked'], false)
    const flipped = panel.flip('允许明文 token 端点')
    assert.equal(flipped.props['aria-checked'], true, '翻转后开关状态应当是开')

    // 仅改此开关也必须标记 connectionChanged，Host 才会应用。
    panel.click(panel.byText('保存到配置行'))
    await panel.settle()
    const [op] = panel.doc.rowCommands ?? []
    assert.ok(op, '保存后没有把命令发给 Host')
    assert.equal(op.op, 'update')
    assert.equal(op.connectionChanged, true)
    assert.equal(op.allowInsecureTokenEndpoint, true, '明文开关没有写进行操作')
    assert.equal(op.failOnStartupError, false, '没碰的开关被打开了')
    assert.equal(op.lazy, false, '编辑不应启用新增的懒加载默认值')
    assert.equal(op.singleMcpEntry, false, '编辑不应启用新增的合并入口默认值')
  } finally {
    panel.restore()
  }
})

test('新增服务器后立刻出现第三张卡片（不等投影回传）', { skip: skipWithoutBundle() }, async () => {
  /**
   * 真机反馈「新增了但页面还是 2 个」。Host 侧实测：HTTP 写入 5ms 完成，但投影要等
   * Loader 重载 patch（约 4 秒）才会出现新行 —— 这中间面板必须有东西可看。
   *
   * 所以这条钉住：**点保存后，卡片立刻就在**，而不是靠投影回传。乐观卡片一直留到真实行
   * 落地（`hasSettled` 对 add 的判据是「投影里出现了」），所以它不会先出现再消失。
   */
  const panel = await bootPanel(emptyDoc({
    profileServers: [
      { entryId: 'include:mcp-context7', serverName: 'context7', scope: 'global', transport: 'streamable-http', target: 'https://mcp.context7.com/mcp', command: '', args: '', env: '', headersText: '', failOnStartupError: false, reconnectInitialDelayMs: '', reconnectMaxDelayMs: '', reconnectMaxAttempts: '', toolCallTimeoutMs: '', enabled: true, phase: '' },
    ],
    rowOpsReady: true, reconnectReady: true,
  }))
  try {
    const before = panel.findAll((node) => String(node.props.className ?? '').includes('smp-cardToggle')).length
    openAddForm(panel)
    panel.change(panel.byPlaceholder('例如 test，最多 32 字符'), 'gitnexus')
    panel.change(panel.byPlaceholder('https://…/mcp'), 'http://sz-00575123-01/mcp/coding')
    panel.click(panel.byText('保存'))
    await panel.settle()

    const op = (panel.doc.rowCommands ?? [])[0]
    assert.ok(op, '没有把命令发给 Host')
    assert.equal(op.op, 'add')
    assert.equal(op.lazy, true, '新增 MCP 应默认按需启动')

    const after = panel.findAll((node) => String(node.props.className ?? '').includes('smp-cardToggle')).length
    assert.equal(after, before + 1, `保存后应立刻多出一张卡片（投影还没回传）：${before} → ${after}`)
    const text = panel.text()
    assert.match(text, /gitnexus/, '乐观卡片要显示用户刚填的名称')
  } finally {
    panel.restore()
  }
})

test('编辑失败：保留草稿和内联错误，不重复弹 toast，允许重试', { skip: skipWithoutBundle() }, async () => {
  const reason = '配置行暂时无法写入'
  const panel = await bootPanel(emptyDoc({ profileServers: [PROFILE_ROW], rowCommandResult: { ok: false, reason } }))
  try {
    panel.click(panel.find((node) => node.props.className === 'smp-moreTrigger'))
    panel.click(panel.byText('编辑'))
    const name = panel.byPlaceholder('例如 test，最多 32 字符')
    panel.change(name, 'keep-draft')
    panel.click(panel.byText('保存到配置行'))
    assert.equal(panel.byText('保存中…').props.disabled, true)
    await panel.settle()

    assert.equal(panel.byPlaceholder('例如 test，最多 32 字符').props.value, 'keep-draft')
    const alerts = panel.findAll((node) => node.props.role === 'alert')
    assert.deepEqual(alerts.map(textOf), [reason])
    assert.deepEqual(panel.toasts(), [])

    panel.doc.rowCommandResult = { ok: true, servers: [PROFILE_ROW] }
    panel.click(panel.byText('保存到配置行'))
    await panel.settle()
    assert.equal(panel.doc.rowCommands.length, 2)
    assert.equal(panel.doc.rowCommands[1].serverName, 'keep-draft')
    assert.equal(panel.byText('保存到配置行'), null)
  } finally {
    panel.restore()
  }
})

test('新增遇到 500：拦截重复提交、保留草稿并显示错误，允许重试', { skip: skipWithoutBundle() }, async () => {
  /**
   * 原来写的是 `if (!response.ok) throw ...`，而那个 throw 被外层 catch 接住、落进
   * `queue()` 并返回 `{ ok: true, queued: true }` —— Host 写文件真的失败时，面板显示的是
   * 「已排队」。乐观卡片就留在那里等一个永远不会来的投影，看起来就是「新增了但没反应」。
   *
   * 只有 404/405/401/403 才意味着「这条路没通」；5xx / 400 是这次命令被拒了，必须让用户看见。
   */
  const requests = []
  let finishFirst
  const firstResponse = new Promise((resolve) => { finishFirst = resolve })
  const panel = await bootPanel(emptyDoc({ profileServers: [], rowOpsReady: true, reconnectReady: true }), {
    fetch: async (url, init) => {
      if (String(url).endsWith('/rows')) {
        requests.push(JSON.parse(String(init.body)))
        if (requests.length === 1) return firstResponse
        return { ok: true, status: 200, json: async () => ({ ok: true, servers: [] }) }
      }
      return { ok: true, status: 200, json: async () => ({ serverTools: [], serverStatus: [], servers: [], serverToolsError: { reason: '', detail: '' } }) }
    },
  })
  try {
    openAddForm(panel)
    panel.change(panel.byPlaceholder('例如 test，最多 32 字符'), 'broken')
    panel.change(panel.byPlaceholder('https://…/mcp'), 'https://x.invalid/mcp')
    panel.change(disclosure(panel, '认证请求头', 'Authorization='), 'Authorization=Bearer retry')

    // 重放同一次渲染的回调，不能只依赖重渲染后的 disabled 状态防重。
    const submit = panel.byText('保存')
    submit.props.onClick({})
    submit.props.onClick({})
    await panel.settle()
    assert.equal(requests.length, 1, '保存尚未完成时最多只能发一条命令')
    finishFirst({
      ok: false, status: 500,
      json: async () => ({ ok: false, reason: 'patch 被占用，写入失败' }),
    })
    await panel.settle()

    assert.deepEqual(panel.doc.rowOps ?? [], [], '500 不该被当成「换旧通道」')
    const modal = addModal(panel)
    assert.ok(modal, 'Host 拒绝保存时，弹窗应保持打开')
    const alerts = inside(modal, (node) => node.props.role === 'alert')
    assert.equal(alerts.length, 1, '弹窗内应有内联错误提醒')
    assert.match(textOf(alerts[0]), /patch 被占用/)
    assert.deepEqual(panel.toasts(), [], '弹窗已显示 Host 原因，不重复弹 toast')
    assert.equal(panel.byPlaceholder('例如 test，最多 32 字符')?.props.value, 'broken')
    assert.equal(panel.byPlaceholder('https://…/mcp')?.props.value, 'https://x.invalid/mcp')
    assert.equal(disclosure(panel, '认证请求头', 'Authorization=').props.value, 'Authorization=Bearer retry')
    assert.equal(panel.findAll((node) => node.type === 'button'
      && String(node.props.className ?? '').includes('smp-cardToggle')).length, 0, '失败应撤掉乐观卡片')

    const retry = panel.byText('保存')
    assert.ok(retry && !retry.props.disabled, '恢复后可重试')
    panel.click(retry)
    await panel.settle()
    assert.equal(requests.length, 2, '重试应再发送一次命令')
    for (const key of ['serverName', 'url', 'headers']) assert.equal(requests[1][key], requests[0][key])
    assert.ok(addModal(panel) === null, '重试成功后关闭弹窗')
  } finally {
    panel.restore()
  }
})
