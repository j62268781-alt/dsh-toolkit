import { pluginApiPath } from '../../../host/paths.js'

/** Canonical plugin identity; the old name is only used when importing existing data. */
export const NAME = 'dsh-toolkit-skills-mcp'
export const LEGACY_NAME = 'skills-mcp-panel'

/**
 * 本模块八条路由共用的前缀。
 *
 * 与插件身份分开：身份是 Cordis 的名字，前缀是 HTTP 契约。client 也会求值这个文件。
 */
export const API_PREFIX = pluginApiPath('skills-mcp')
