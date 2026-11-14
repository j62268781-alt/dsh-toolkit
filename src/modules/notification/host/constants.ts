import { pluginApiPath } from '../../../host/paths.js'

/**
 * 提示音 / 抬窗三条路由的路径。
 *
 * 与 client 共用同一份：client 会把这个文件打进浏览器，所以这里不能有 Node 依赖。
 */
const API_PREFIX = pluginApiPath('notification')

export const SOUNDS_PATH = `${API_PREFIX}/sounds`
export const SOUND_PATH = `${API_PREFIX}/sound`
export const RAISE_PATH = `${API_PREFIX}/raise`
