import * as plugin from './lib/modules/pet/host/index.js'
export * from './lib/modules/pet/host/index.js'
export const name = 'dsh-toolkit-pet'
import { Config } from './lib/modules/pet/host/config.js'
export { Config }
export default { ...plugin, name, Config }
