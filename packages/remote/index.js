import * as plugin from './lib/modules/remote/host/index.js'
export * from './lib/modules/remote/host/index.js'
export const name = 'dsh-toolkit-remote'
import { Config } from './lib/modules/remote/host/wechat/config.js'
export { Config }
export default { ...plugin, name, Config }
