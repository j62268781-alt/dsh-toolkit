import { pluginApiPath } from "../../../host/paths.js";

/**
 * 本模块的路由前缀：`/api/plugins/toolkit/mobile`。
 *
 * 宿主路由表与 client 的请求都从这里取；client 会把这个文件打进浏览器，
 * 所以它不能有 Node 依赖。
 */
export const API_PREFIX = pluginApiPath("mobile");
