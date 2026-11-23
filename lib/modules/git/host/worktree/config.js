import { HttpFailure, httpFailure } from '../../../../host/routes.js';
const MODULE = '@deepseek-ai/dsh-experimental-worktree';
// Installed Cordis FiberState.ACTIVE is a const enum, not a runtime export.
const ACTIVE = 2;
function fields(value) {
    if (value === null || typeof value !== 'object')
        return;
    const { directory, namePrefix } = value;
    if (typeof directory === 'string' && typeof namePrefix === 'string')
        return { directory, namePrefix };
}
function relativePath(path) {
    return path.length > 0 && !/[\\:\0]/.test(path)
        && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function isWorktreeConfigUpdate(value) {
    const next = fields(value);
    if (next === undefined || !fields(value.expected))
        return false;
    // Mirror native WorktreeService's constructor checks, additionally rejecting an unusable NUL path.
    return relativePath(next.directory) && !next.namePrefix.startsWith('-') && relativePath(`${next.namePrefix}name`);
}
function unavailable() {
    return httpFailure(404, 'worktree-config-unavailable');
}
function target(editor) {
    if (typeof editor?.entries !== 'function' || typeof editor.edit !== 'function')
        throw unavailable();
    const matches = editor.entries().filter(entry => entry.options.id === 'worktree' && entry.options.name === MODULE);
    if (matches.length !== 1)
        throw unavailable();
    if (matches[0].fiber?.state !== ACTIVE)
        throw unavailable();
    return { editor, entry: matches[0] };
}
function safeFailure(error) {
    if (error instanceof HttpFailure)
        throw error;
    // Loader errors can embed local paths, raw config and interpolation details.
    throw httpFailure(500, 'worktree-config-failed');
}
export function readWorktreeConfig(editor) {
    try {
        const value = fields(target(editor).entry.fiber?.effectiveConfig);
        if (value === undefined)
            throw unavailable();
        return value;
    }
    catch (error) {
        return safeFailure(error);
    }
}
export async function updateWorktreeConfig(service, update) {
    const { directory, namePrefix, expected } = update;
    const result = { directory, namePrefix };
    const noChange = new Error('native worktree config already current');
    try {
        const { editor, entry } = target(service);
        await editor.edit(entry, (current) => {
            // ConfigEditor has reloaded profile patches under its lock. Resolve this raw candidate so
            // comparison uses the same defaults and interpolation as GET, without writing them back.
            const fiber = entry.fiber;
            if (fiber?.state !== ACTIVE)
                throw unavailable();
            const actual = fields(fiber.resolveConfig(current));
            if (actual === undefined)
                throw unavailable();
            if (actual.directory !== expected.directory || actual.namePrefix !== expected.namePrefix) {
                throw httpFailure(409, 'worktree-config-conflict');
            }
            if (actual.directory === directory && actual.namePrefix === namePrefix)
                throw noChange;
            return {
                ...current,
                ...(actual.directory !== directory ? { directory } : {}),
                ...(actual.namePrefix !== namePrefix ? { namePrefix } : {}),
            };
        });
        return result;
    }
    catch (error) {
        if (error === noChange)
            return result;
        return safeFailure(error);
    }
}
