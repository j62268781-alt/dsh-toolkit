// Host-only entry for the external ds-harness-remote plugin.
//
// The bundle mounts ds-harness-remote through this shim instead of pointing a
// loader row straight at the npm package. The dsh client-module system scans
// every loader row's package manifest for a `dsh.client` declaration; pointing
// the row at `ds-harness-remote` would therefore also mount its own sidebar
// entry and settings pages next to the unified "远程连接" popup in this
// bundle. Re-exporting the host faces through a manifest without `dsh.client`
// keeps the pairing/Bridge host runtime (control route, settings binding,
// device identity) while leaving the browser UI to this bundle alone.
//
import { apply as applyRemote } from 'ds-harness-remote'
import { migrateLegacyBridgeState } from 'dsh-toolkit-remote/wechat-state-migration'

export { Config, name } from 'ds-harness-remote'

export function apply(ctx, entry) {
  try {
    migrateLegacyBridgeState()
  } catch (error) {
    ctx.logger?.warn?.('Remote: 微信桥旧状态迁移失败，已保留未迁移的文件。', error)
  }
  return applyRemote(ctx, entry)
}
