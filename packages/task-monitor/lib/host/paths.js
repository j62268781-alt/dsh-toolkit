/**
 * 插件 HTTP 路由的唯一前缀约定：`/api/plugins/toolkit/<module>/<resource>`。
 *
 * 放在 src/host 而不是各模块里，是因为 host 的路由表与调用它的 client 必须用同一份；
 * `module` 取 `src/modules/<module>` 的目录名（archived / mobile / skills-mcp …）。
 *
 * 这个文件没有任何 import：client bundle 会求值它，带上 Node 依赖就会在浏览器里炸。
 */
export const PLUGIN_API_ROOT = '/api/plugins/toolkit';
/** 某个模块自己的路由前缀。 */
export function pluginApiPath(moduleName) {
    return `${PLUGIN_API_ROOT}/${moduleName}`;
}
//# sourceMappingURL=paths.js.map