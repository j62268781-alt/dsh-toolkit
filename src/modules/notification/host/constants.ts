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

/**
 * 通知点击处理器（Service Worker）的脚本路径。
 *
 * 这条路由**不鉴权**：浏览器注册 SW 时是独立发起的脚本请求，带不上页面 URL 里的 token，
 * 走 `registerAuthenticatedRoute` 必然 401。脚本里只有常量和事件处理，没有任何数据。
 */
export const SERVICE_WORKER_PATH = `${API_PREFIX}/sw.js`

/**
 * 注册时要的 scope。
 *
 * 必须放宽到站点根：只有控制住应用页面，`clients.matchAll()` 才能看到那个标签页，
 * 点击通知才有「聚焦已有窗口」这条路（否则只能每次新开一个）。
 */
export const SERVICE_WORKER_SCOPE = '/'
