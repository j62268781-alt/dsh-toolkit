/**
 * 清理本机与某个配对服务器相关的残留状态（解绑之后的「善后」）。
 *
 * 为什么需要它：解绑走的是上游 `settings.logout`（service.js 的 clearHostAuthorization），
 * 它只做「注销设备 + 清凭据 + 轮换身份」，落盘清理范围是 identity-store 的
 * removeIdentityRecords：device.json / device.key / trusted-peers.json / host-pairing.json。
 * 它**有意不删**两样东西：
 *
 *   · `host/pairing-host-only.json`（`{"hostOnly":true}`）：安装级策略「本机只被控」。
 *     只有真正配过对才会写出（server-api.js 的 adoptPairing，服务端说 pairingRestricted 时）。
 *     留着它，解绑重启后 serverApi.loadStoredPolicy() 又把 hostOnly 读成 true，
 *     面板拿到 `status.host.pairingHostOnly === true` + 一条普通的 401，就会把
 *     「这台机器还没有授权」讲成「配对授权已被移除」——用户已经解绑了，看到的还是旧配对叙事。
 *   · `client/` 角色目录：hostOnly 下这台机器根本不可能创建 client 身份
 *     （DEVICE_SCOPE_REQUIRED），那里的 device.json 只会是更早那份状态留下的残骸。
 *
 * 所以解绑后要由我们自己补上这一刀：删策略文件；当时确实是 hostOnly 的话，连带 client 目录。
 *
 * 边界：
 *   · 不删 host/device.json、host/device.key：运行中的 host 运行时就持有那份身份，
 *     删了只会让内存与磁盘不一致，重启后上游会自己 loadOrCreate 一份新的。
 *   · 幂等：文件本来就不存在也算成功（返回的 removed 里不会出现）。
 *   · 目录规则与 peers.js 完全一致：<DSH_HOME>/ds-harness-remote/servers/<scope>/。
 */

import { lstat, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { dshHomePath, serverScope } from './peers.js'

/** 某个服务器在本机的存储根目录（上游 identity-store 的 servers/<scope>）。 */
export function serverStateDir({ serverUrl, homeDir = dshHomePath() } = {}) {
  return join(homeDir, 'ds-harness-remote', 'servers', serverScope(serverUrl))
}

/** 「本机只被控」策略文件的绝对路径。 */
export function pairingHostOnlyPath({ serverUrl, homeDir } = {}) {
  return join(serverStateDir({ serverUrl, homeDir }), 'host', 'pairing-host-only.json')
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

/**
 * 读「本机只被控」策略。文件不存在 / 内容坏了都当 false：
 * 上游那边也是「读不到就当没有这个策略」，我们不能比它更严格。
 */
export async function readPairingHostOnly({ serverUrl, homeDir } = {}) {
  try {
    const parsed = JSON.parse(await readFile(pairingHostOnlyPath({ serverUrl, homeDir }), 'utf8'))
    return parsed?.hostOnly === true
  } catch {
    return false
  }
}

/**
 * 删掉解绑后仍然残留的本机状态。
 *
 * 返回 `{ dir, hostOnly, removed }`：`hostOnly` 是删之前读到的策略值，
 * `removed` 是真正删掉的相对路径（客户端只用来判断「有没有清干净」，不参与展示）。
 */
export async function purgePairingState({ serverUrl, homeDir } = {}) {
  const dir = serverStateDir({ serverUrl, homeDir })
  const removed = []
  const hostOnly = await readPairingHostOnly({ serverUrl, homeDir })

  const policy = join(dir, 'host', 'pairing-host-only.json')
  if (await exists(policy)) {
    await rm(policy, { force: true })
    removed.push('host/pairing-host-only.json')
  }

  // client 目录只有「这台机器曾经是 hostOnly」时才是残骸：普通安装（能控制别的设备）
  // 里的 client 身份是合法状态，不能顺手删掉。
  const clientDir = join(dir, 'client')
  if (hostOnly && await exists(clientDir)) {
    await rm(clientDir, { recursive: true, force: true })
    removed.push('client')
  }

  return { dir, hostOnly, removed }
}
