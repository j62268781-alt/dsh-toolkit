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
/**
 * 与上游一致：DSH_HOME 优先，否则 ~/.dsh。
 *
 * 默认值用 `/` 手工拼接而不是 `join`：这个值会被写进面板、日志和跨端比较里，
 * Windows 的 `join` 会把它变成 `C:\Users\x\.dsh` 这种只在 Windows 成立的串。
 * 混用斜杠对 Node 的 fs 是合法的，所以盘符路径也一样能读。
 */
export declare function dshHomePath(env?: NodeJS.ProcessEnv, home?: string): string;
/** 服务器地址 → 上游的存储目录名（sha256(origin) 前 24 位十六进制）。 */
export declare function serverScope(serverUrl: any): string;
/** 该服务器对应的 trusted-peers.json 绝对路径。 */
export declare function trustedPeersPath({ serverUrl, homeDir }?: any): string;
/**
 * 读某个服务器的已信任设备，最近配对成功的排在最前。
 *
 * 返回 `{ path, peers }`；文件不存在是正常情况（从未配对过），返回空数组。
 */
export declare function readTrustedPeers({ serverUrl, homeDir }?: any): Promise<{
    path: string;
    peers: any;
}>;
//# sourceMappingURL=peers.d.ts.map