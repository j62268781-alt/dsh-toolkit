import { GIT_PUBLISH_ACTION_PATH, GIT_PUBLISH_PREVIEW_PATH } from '../constants.js';
function isRequest(value) {
    return value !== null && typeof value === 'object' && typeof value.cwd === 'string'
        && (value.action === 'commit' || value.action === 'push');
}
function isConfirmation(value) {
    return typeof value?.token === 'string' && /^[\w-]{32}$/.test(value.token) && isRequest(value);
}
function reply(result) {
    if (result.ok === true)
        return [200, result];
    if (result.reason === 'invalid-cwd' || result.reason === 'invalid-message')
        return [400, result];
    if (result.reason === 'git-missing')
        return [503, result];
    return [409, result];
}
export function createGitPublishRoutes(publish) {
    return [
        {
            path: GIT_PUBLISH_PREVIEW_PATH,
            limit: 8192,
            check: isRequest,
            reason: 'invalid-publish-request',
            run: async (_ctx, value) => reply(await publish.preview(value)),
        },
        {
            path: GIT_PUBLISH_ACTION_PATH,
            // Escaped JSON chars can occupy six characters each in the raw body.
            limit: 32 * 1024,
            check: isConfirmation,
            reason: 'invalid-publish-confirmation',
            run: async (_ctx, value) => reply(await publish.confirm(value)),
        },
    ];
}
