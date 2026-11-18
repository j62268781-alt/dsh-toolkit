import { MONITOR_REASON, MONITOR_SNAPSHOT_PATH, MONITOR_SOURCE_ADD_PATH, MONITOR_SOURCE_REMOVE_PATH, } from '../constants.js';
/** sessionId + 类型 + 最长 2048 字符的来源值，8 KiB 解码字符足够。 */
const LIMIT = 8192;
const STATUS = {
    [MONITOR_REASON.invalidSession]: 400,
    [MONITOR_REASON.invalidSource]: 400,
    [MONITOR_REASON.notManual]: 409,
    [MONITOR_REASON.notFound]: 404,
    [MONITOR_REASON.disabled]: 409,
    [MONITOR_REASON.storeFailed]: 500,
};
function reply(result) {
    if (result.ok === true)
        return [200, result];
    return [STATUS[result.code] ?? 500, result];
}
const isString = (value) => typeof value === 'string';
const sessionOf = (body) => (body !== null && typeof body === 'object' ? body.sessionId : undefined);
const tripleOf = (body) => body !== null && typeof body === 'object' ? [body.sessionId, body.kind, body.value] : undefined;
const isTriple = (value) => Array.isArray(value) && value.every(isString);
const pairOf = (body) => body !== null && typeof body === 'object' ? [body.sessionId, body.id] : undefined;
const isPair = (value) => Array.isArray(value) && value.every(isString);
export function createMonitorRoutes({ store }) {
    return [
        {
            path: MONITOR_SNAPSHOT_PATH,
            limit: LIMIT,
            pick: sessionOf,
            check: isString,
            reason: 'sessionId 必须是字符串',
            run: async (_ctx, sessionId) => reply(await store.snapshot(sessionId)),
        },
        {
            path: MONITOR_SOURCE_ADD_PATH,
            limit: LIMIT,
            pick: tripleOf,
            check: isTriple,
            reason: 'sessionId、kind、value 必须是字符串',
            run: async (_ctx, value) => reply(await store.addSource(value[0], value[1], value[2])),
        },
        {
            path: MONITOR_SOURCE_REMOVE_PATH,
            limit: LIMIT,
            pick: pairOf,
            check: isPair,
            reason: 'sessionId 与 id 必须是字符串',
            run: async (_ctx, value) => reply(await store.removeSource(value[0], value[1])),
        },
    ];
}
//# sourceMappingURL=highlights.js.map