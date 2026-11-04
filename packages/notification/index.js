import * as plugin from './lib/modules/notification/host/index.js'
export * from './lib/modules/notification/host/index.js'
export const name = 'dsh-toolkit-notification'
import { Config } from './lib/modules/notification/host/config.js'
export { Config }
export default { ...plugin, name, Config }
