/** Build both halves from the one source tree. --check never writes outputs. */
import { buildHost } from './build-host.mjs'
import { buildClient } from './build-client.mjs'

const check = process.argv.includes('--check')
await buildHost({ check })
await buildClient({ check })
