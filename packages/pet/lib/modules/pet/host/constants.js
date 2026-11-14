import { pluginApiPath } from '../../../host/paths.js';
/**
 * 宠物面板四条路由（state / events / asset / action）共用的前缀。
 *
 * client 也会求值这个文件，所以不能有 Node 依赖。
 */
export const API_PREFIX = pluginApiPath('pet');
/** 既有导出名，路由表用它拼子路径。 */
export const API_PATH = API_PREFIX;
//# sourceMappingURL=constants.js.map