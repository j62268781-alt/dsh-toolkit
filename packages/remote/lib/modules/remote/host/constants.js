import { pluginApiPath } from '../../../host/paths.js';
/**
 * remote 模块十二条路由共用的前缀。
 *
 * client（配对页与微信面板）也用它拼 URL，所以这个文件不能有 Node 依赖。
 */
export const API_PREFIX = pluginApiPath('remote');
/** 既有导出名，路由表用它拼子路径。 */
export const API_PATH = API_PREFIX;
//# sourceMappingURL=constants.js.map