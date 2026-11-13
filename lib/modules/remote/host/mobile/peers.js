/**
 * 读取 ds-harness-remote 落盘的「已信任设备」。
 *
 * 为什么需要它：配对会话记录只保留到过期后 5 分钟，之后 `host.pairing.status`
 * 就再拿不到手机名与指纹；浏览器 localStorage 又与 origin（含端口）绑定，DSH
 * 重启换了端口就整份丢失。真正跨重启持久的是 ds-harness-remote 自己的
 * `trusted-peers.json`——它就在本机盘上，由 host 半边只读地取出来给面板兜底。
 *
 * 目录规则来自上游 identity-store：`<DSH_HOME>/ds-harness-remote/servers/
 * <sha256(serverUrl origin) 前 24 位>/host/trusted-peers.json`。
 *
 * 边界：
 *   · 只读，不写；读不到/损坏一律当成「没有 peer」，不让面板整块报错。
 *   · 只回身份字段（deviceId/name/platform/fingerprint/trustedAt），不回 publicKey。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** 与上游一致：DSH_HOME 优先，否则 ~/.dsh。 */
export function dshHomePath(env = process.env, home = homedir()) {
    const fromEnv = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
    return fromEnv !== '' ? fromEnv : join(home, '.dsh');
}
/** 服务器地址 → 上游的存储目录名（sha256(origin) 前 24 位十六进制）。 */
export function serverScope(serverUrl) {
    let parsed;
    try {
        parsed = new URL(String(serverUrl));
    }
    catch {
        throw Object.assign(new Error('配对服务器地址不是合法 URL'), { statusCode: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw Object.assign(new Error('配对服务器只支持 http/https'), { statusCode: 400 });
    }
    return createHash('sha256').update(parsed.origin).digest('hex').slice(0, 24);
}
/** 该服务器对应的 trusted-peers.json 绝对路径。 */
export function trustedPeersPath({ serverUrl, homeDir = dshHomePath() } = {}) {
    return join(homeDir, 'ds-harness-remote', 'servers', serverScope(serverUrl), 'host', 'trusted-peers.json');
}
function text(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/**
 * 读某个服务器的已信任设备，最近配对成功的排在最前。
 *
 * 返回 `{ path, peers }`；文件不存在是正常情况（从未配对过），返回空数组。
 */
export async function readTrustedPeers({ serverUrl, homeDir } = {}) {
    const path = trustedPeersPath({ serverUrl, homeDir });
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')
            return { path, peers: [] };
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { path, peers: [] };
    }
    const list = Array.isArray(parsed?.peers) ? parsed.peers : [];
    const peers = list
        .filter((peer) => peer !== null && typeof peer === 'object')
        .map((peer) => ({
        deviceId: text(peer.deviceId),
        name: text(peer.name),
        platform: text(peer.platform),
        fingerprint: text(peer.fingerprint),
        trustedAt: Number.isFinite(peer.trustedAt) ? peer.trustedAt : 0,
    }))
        .filter((peer) => peer.deviceId !== undefined)
        .sort((a, b) => b.trustedAt - a.trustedAt);
    return { path, peers };
}
//# sourceMappingURL=peers.js.map