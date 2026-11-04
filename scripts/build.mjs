/** Build both halves from the one source tree. --check never writes outputs. */
import { buildHost } from './build-host.mjs'
import { buildClient } from './build-client.mjs'
import { buildPackages } from './build-packages.mjs'

const check = process.argv.includes('--check')
const hostOutputs = await buildHost({ check })
await buildClient({ check })
await buildPackages({ check, hostOutputs })
