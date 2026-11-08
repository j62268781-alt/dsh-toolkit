/** Build-time identities only; package manifests and wrappers remain hand-maintained. */
export const PACKAGE_MODULES = Object.freeze([
  { name: 'boot', client: { entry: 'src/modules/boot/client/index.jsx', factory: false }, skills: [] },
  { name: 'theme', client: { entry: 'src/modules/theme/client/index.js', factory: false }, skills: [] },
  { name: 'archived', client: { entry: 'src/modules/archived/client/index.js', factory: false }, skills: [] },
  { name: 'browser', client: { entry: 'src/modules/browser/client/index.jsx', factory: false }, skills: ['agent-browser'] },
  { name: 'judgment', client: { entry: 'src/modules/judgment/client/index.jsx', factory: false }, skills: [] },
  { name: 'mobile', client: { entry: 'src/modules/mobile/client/index.jsx', factory: true }, skills: ['mobilecli'] },
  { name: 'skills-mcp', client: { entry: 'src/modules/skills-mcp/client/client.js', factory: true }, skills: [] },
  { name: 'notification', client: { entry: 'src/modules/notification/client/index.jsx', factory: true }, skills: [] },
  { name: 'pet', client: { entry: 'src/modules/pet/client/index.jsx', factory: true }, skills: [] },
  { name: 'weixin-clawbot', client: { entry: 'src/modules/weixin-clawbot/client/index.jsx', factory: true }, skills: [] },
].map((module) => Object.freeze({ ...module, packageName: `dsh-toolkit-${module.name}` })))
