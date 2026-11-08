import * as plugin from './lib/modules/weixin-clawbot/host/index.js'
export * from './lib/modules/weixin-clawbot/host/index.js'
export const name = 'dsh-toolkit-weixin-clawbot'
import { Config } from './lib/modules/weixin-clawbot/host/config.js'
export { Config }
export default { ...plugin, name, Config }
