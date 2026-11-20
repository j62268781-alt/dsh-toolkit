const WRITE_TOOLS = new Set(['write', 'edit', 'multi_edit', 'multiedit', 'notebook_edit']);
const KNOWLEDGE_TOOLS = new Set(['search_knowledge', 'searchknowledge', 'search_workspace', 'searchworkspace']);
const KNOWLEDGE_SERVER = /repowiki|qmind|knowledge/i;
const BROWSER_NAVIGATE = /navigate|fetch|open|goto|new_page/i;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export function baseName(path) {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return path.slice(cut + 1) || path;
}
export function dirName(path) {
    const normalized = path.replace(/\\/g, '/');
    const cut = normalized.lastIndexOf('/');
    return cut <= 0 ? '' : normalized.slice(0, cut);
}
export function hostOf(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return url;
    }
}
/**
 * 同一文件会被工具写成 `src/a.ts`、`./src/a.ts`、`src\\a.ts` 三种拼法，
 * 按原文当 id 会变成三条。归一（去 `./`、反斜杠转正斜杠）后合并成一条。
 */
export function normalizePath(path) {
    return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}
export function artifactSeed(path) {
    return fileSeed('artifact', 'artifact', path);
}
function fileSeed(kind, prefix, path) {
    const clean = normalizePath(path);
    return { kind, id: `${prefix}:${clean}`, label: baseName(clean), detail: dirName(clean), target: clean };
}
/** 一次调用可能产出多条种子（present 的 files 数组）；归不了类的调用返回空数组。 */
export function classifyCall(name, args) {
    if (typeof name !== 'string' || name === '')
        return [];
    const lower = name.toLowerCase();
    const input = record(args);
    if (lower === 'skill') {
        const label = text(input.skill) || text(input.name) || 'Skill';
        return [{ kind: 'capability', id: `skill:${label}`, label, detail: 'Skill' }];
    }
    if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        const server = parts[1] ?? '';
        const tool = parts.slice(2).join('__') || server;
        if (KNOWLEDGE_SERVER.test(server)) {
            const label = text(input.query) || text(input.title) || tool;
            return [{ kind: 'knowledge', id: `mcp:${name}`, label, detail: `${server} · ${tool}` }];
        }
        const url = text(input.url);
        if (/browser/i.test(server) && BROWSER_NAVIGATE.test(tool) && url !== '') {
            return [{ kind: 'web', id: `url:${url}`, label: hostOf(url), detail: url, target: url }];
        }
        // 同一个 MCP server 的 N 个工具算一个「来源」：面板要的是「这轮用过哪个 MCP」，
        // 逐个工具列出来（读文件一个、抓页面一个…）只是噪音。
        return [{ kind: 'capability', id: `mcp:${server}`, label: server, detail: '' }];
    }
    if (WRITE_TOOLS.has(lower)) {
        const path = text(input.file_path) || text(input.path);
        return path === '' ? [] : [artifactSeed(path)];
    }
    if (lower === 'present') {
        const files = Array.isArray(input.files) ? input.files : [];
        const seeds = [];
        for (const file of files) {
            const path = text(record(file).path);
            if (path !== '')
                seeds.push(artifactSeed(path));
        }
        return seeds;
    }
    if (lower === 'web_fetch') {
        const url = text(input.url);
        return url === '' ? [] : [{ kind: 'web', id: `url:${url}`, label: hostOf(url), detail: url, target: url }];
    }
    if (lower === 'web_search') {
        const query = text(input.query);
        return query === '' ? [] : [{ kind: 'web', id: `search:${query}`, label: query, detail: 'web_search' }];
    }
    if (KNOWLEDGE_TOOLS.has(lower)) {
        const query = text(input.query) || text(input.requirements);
        return [{ kind: 'knowledge', id: `knowledge:${lower}:${query}`, label: query || lower, detail: lower }];
    }
    return [];
}
//# sourceMappingURL=classify.js.map