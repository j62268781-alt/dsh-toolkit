import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSerialQueue } from '../../../../../host/serial.js';
/** Storage format version. */
export const STORE_VERSION = 1;
const MAX_BYTES = 512 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const queues = new Map();
function queueFor(file) {
    const key = resolve(file);
    let queue = queues.get(key);
    if (queue === undefined) {
        queue = createSerialQueue();
        queues.set(key, queue);
    }
    return queue;
}
export function isValidServerName(name) {
    if (typeof name !== 'string' || NAME_PATTERN.test(name) !== true)
        return false;
    return name !== '.' && name !== '..';
}
export function oauthDir(dshHome) {
    return join(dshHome, 'dsh-skills-mcp-manager', 'oauth');
}
export function oauthFile(dshHome, serverName) {
    if (!isValidServerName(serverName))
        return '';
    return join(oauthDir(dshHome), `${serverName}.json`);
}
export function emptyRecord(serverName, url) {
    return {
        version: STORE_VERSION,
        serverName,
        url: typeof url === 'string' ? url : '',
        clientInformation: null,
        tokens: null,
        tokensSavedAt: '',
        discoveryState: null,
        codeVerifier: '',
        resourceUrl: '',
        pending: null,
        updatedAt: '',
    };
}
export function normalizeRecord(raw, serverName, url) {
    const base = emptyRecord(serverName, url);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return base;
    if (raw.version !== STORE_VERSION)
        return base;
    const record = {
        ...base,
        clientInformation: objectOr(raw.clientInformation, null),
        tokens: objectOr(raw.tokens, null),
        tokensSavedAt: typeof raw.tokensSavedAt === 'string' ? raw.tokensSavedAt : '',
        discoveryState: objectOr(raw.discoveryState, null),
        codeVerifier: typeof raw.codeVerifier === 'string' ? raw.codeVerifier : '',
        resourceUrl: typeof raw.resourceUrl === 'string' ? raw.resourceUrl : '',
        pending: objectOr(raw.pending, null),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
    record.url = base.url !== '' ? base.url : (typeof raw.url === 'string' ? raw.url : '');
    return record;
}
function objectOr(value, fallback) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}
export function createOAuthStore({ dshHome, log } = {}) {
    const dir = oauthDir(dshHome);
    const readRecord = async (serverName, url = '') => {
        const file = oauthFile(dshHome, serverName);
        if (file === '')
            return emptyRecord(serverName, url);
        let text;
        try {
            text = await readFile(file, 'utf8');
        }
        catch {
            return emptyRecord(serverName, url);
        }
        if (text.length > MAX_BYTES) {
            log?.warn?.(`dsh-skills-mcp-manager: 凭据文件 ${file} 过大，已忽略`);
            return emptyRecord(serverName, url);
        }
        let raw;
        try {
            raw = JSON.parse(text);
        }
        catch (error) {
            log?.warn?.(`dsh-skills-mcp-manager: 凭据文件 ${file} 不是合法 JSON：${String(error?.message ?? error)}`);
            return emptyRecord(serverName, url);
        }
        return normalizeRecord(raw, serverName, url);
    };
    const writeRecord = async (serverName, record) => {
        const file = oauthFile(dshHome, serverName);
        if (file === '')
            throw new Error(`服务器名不能用作文件名：${String(serverName)}`);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const next = { ...record, version: STORE_VERSION, serverName, updatedAt: new Date().toISOString() };
        const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
            await rename(temp, file);
            try {
                await chmod(file, 0o600);
            }
            catch (error) {
                log?.warn?.(`dsh-skills-mcp-manager: 无法把 ${file} 的权限收紧到 0600：${String(error?.message ?? error)}`);
            }
            return next;
        }
        finally {
            try {
                await unlink(temp);
            }
            catch (error) {
                if (error?.code !== 'ENOENT')
                    log?.warn?.(`dsh-skills-mcp-manager: 清理临时凭据文件 ${temp} 失败：${String(error?.message ?? error)}`);
            }
        }
    };
    const removeRecord = async (serverName) => {
        const file = oauthFile(dshHome, serverName);
        if (file === '')
            return false;
        try {
            await unlink(file);
            return true;
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return false;
            log?.warn?.(`dsh-skills-mcp-manager: 删除凭据 ${file} 失败：${String(error?.message ?? error)}`);
            return false;
        }
    };
    return {
        dir,
        file: (serverName) => oauthFile(dshHome, serverName),
        read: readRecord,
        update: async (serverName, url, mutate) => {
            const file = oauthFile(dshHome, serverName);
            if (file === '')
                throw new Error(`服务器名不能用作文件名：${String(serverName)}`);
            return queueFor(file).run(async () => {
                const current = await readRecord(serverName, url);
                const next = (await mutate(current)) ?? current;
                return writeRecord(serverName, next);
            });
        },
        write: async (serverName, record) => {
            const file = oauthFile(dshHome, serverName);
            if (file === '')
                throw new Error(`服务器名不能用作文件名：${String(serverName)}`);
            return queueFor(file).run(() => writeRecord(serverName, record));
        },
        remove: async (serverName) => {
            const file = oauthFile(dshHome, serverName);
            if (file === '')
                return false;
            return queueFor(file).run(() => removeRecord(serverName));
        },
    };
}
//# sourceMappingURL=store.js.map