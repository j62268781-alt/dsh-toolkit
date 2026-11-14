/**
 * `matcher` 的匹配规则：空串或 `*` 匹配全部；其余按逗号分隔成多个正则，命中任一即可。
 *
 * 与 Claude Code 的差别只有一处：这里用**不区分大小写**的正则。宿主工具名是小写
 * （`bash`、`edit_file`），而大多数人是从 Claude Code 的配置里抄过来的 `Bash` / `Edit`，
 * 区分大小写会让 `"matcher": "Edit|Write"` 这类写法悄悄一条都不命中。
 */
import { MAX_MATCHER_LENGTH } from '../constants.js';
const CACHE = new Map();
function compile(part) {
    const cached = CACHE.get(part);
    if (cached !== undefined)
        return cached;
    let compiled;
    try {
        compiled = new RegExp(part, 'i');
    }
    catch (error) {
        compiled = error instanceof Error ? error : new Error(String(error));
    }
    // 配置里最多几十条 matcher；不设上限，但超过 500 条说明有人在批量生成，清掉即可。
    if (CACHE.size > 500)
        CACHE.clear();
    CACHE.set(part, compiled);
    return compiled;
}
export function checkMatcher(matcher, subject) {
    const trimmed = matcher.trim();
    if (trimmed === '' || trimmed === '*')
        return { matches: true };
    if (trimmed.length > MAX_MATCHER_LENGTH) {
        return { matches: false, error: `matcher 超过 ${MAX_MATCHER_LENGTH} 个字符` };
    }
    for (const part of trimmed.split(',').map((piece) => piece.trim()).filter((piece) => piece !== '')) {
        const compiled = compile(part);
        if (compiled instanceof Error)
            return { matches: false, error: `matcher 不是合法正则：${part}` };
        if (compiled.test(subject))
            return { matches: true };
    }
    return { matches: false };
}
//# sourceMappingURL=matcher.js.map