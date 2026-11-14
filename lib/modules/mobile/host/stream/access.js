/** DSH identity is enforced at route registration; these checks add local transport and stream capabilities. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { dshHome } from "../../../../host/dsh-home.js";
export const TOKEN_TTL_MS = 10 * 60 * 1000;
export const ROUTES = {
    stream: "stream",
    screenshot: "screenshot",
    grant: "grant",
    devices: "devices",
    switchDevice: "switch-device",
    control: "control",
    deviceAction: "device-action",
    status: "status",
    // Polled from client apply(), so tools can open a panel that is not mounted yet.
    panelOpen: "panel-open",
    panelOpenAck: "panel-open-ack",
};
export function stateRoot() {
    return join(dshHome(), "cache", "dsh-toolkit-mobile");
}
/** Reuse a per-DSH_HOME signing key; controller generations revoke capabilities on reload. */
export function prepareStreamAccessKey() {
    const dir = stateRoot();
    const keyPath = join(dir, "stream-access.key");
    try {
        const existing = readFileSync(keyPath);
        if (existing.length === 32)
            return existing;
    }
    catch {
        // Create it below when absent or unreadable.
    }
    const key = randomBytes(32);
    try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
        try {
            chmodSync(keyPath, 0o600);
        }
        catch { /* Not supported by every filesystem. */ }
        return key;
    }
    catch {
        try {
            const existing = readFileSync(keyPath);
            return existing.length === 32 ? existing : key;
        }
        catch {
            return key;
        }
    }
}
/** Only actual IP literals qualify; a hostname beginning with 127. is not loopback. */
export function isLoopbackRemoteAddress(address) {
    const kind = typeof address === "string" ? isIP(address) : 0;
    if (kind === 4)
        return address.split(".")[0] === "127";
    if (kind !== 6 || address.includes("%"))
        return false;
    const canonical = new URL(`http://[${address}]/`).hostname;
    if (canonical === "[::1]")
        return true;
    // URL canonicalizes both dotted and hexadecimal IPv4-mapped IPv6 addresses.
    const mapped = /^\[::ffff:([0-9a-f]+):[0-9a-f]+\]$/.exec(canonical);
    return mapped !== null && (Number.parseInt(mapped[1], 16) >>> 8) === 127;
}
function normalizeHost(host) {
    if (isIP(host) === 4)
        return host;
    // Reject malformed dotted numeric IPs rather than treating them as DNS names.
    if (/^[\d.]+$/.test(host) || host.length > 253)
        return null;
    const name = host.endsWith(".") ? host.slice(0, -1) : host;
    if (name === "" || !name.split(".").every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))
        return null;
    return host.toLowerCase();
}
/** Parse authority without URL's permissive userinfo, IP shorthand or invalid-port normalization. */
function parseAuthorityFromHeader(value) {
    if (typeof value !== "string" || value === "" || /[\s/\\?#@]/.test(value))
        return null;
    let host;
    let portPart;
    if (value.startsWith("[")) {
        const match = /^\[([^\]]+)\](?::([^:]*))?$/.exec(value);
        if (match === null || isIP(match[1]) !== 6 || match[1].includes("%"))
            return null;
        host = new URL(`http://[${match[1]}]/`).hostname;
        portPart = match[2];
    }
    else {
        const match = /^([^:\[\]]+)(?::([^:]*))?$/.exec(value);
        if (match === null)
            return null;
        const normalized = normalizeHost(match[1]);
        if (normalized === null)
            return null;
        host = normalized;
        portPart = match[2];
    }
    if (portPart === undefined)
        return { host, port: 0 };
    if (!/^\d{1,5}$/.test(portPart))
        return null;
    const port = Number(portPart);
    return port >= 1 && port <= 65535 ? { host, port } : null;
}
/** host permits any port, host:port pins it, and http(s)://host:port also pins Origin's scheme. */
export function parseTrustedAuthority(entry) {
    if (typeof entry !== "string")
        return null;
    let rest = entry.trim();
    let scheme = null;
    const schemeMatch = /^(https?):\/\//i.exec(rest);
    if (schemeMatch !== null) {
        scheme = schemeMatch[1].toLowerCase();
        rest = rest.slice(schemeMatch[0].length);
    }
    const authority = parseAuthorityFromHeader(rest);
    return authority === null ? null : { ...authority, port: authority.port || null, scheme };
}
function parseOrigin(value) {
    if (typeof value !== "string")
        return null;
    const match = /^(https?):\/\/([^/]+)\/?$/i.exec(value);
    if (match === null)
        return null;
    const authority = parseAuthorityFromHeader(match[2]);
    return authority === null ? null : { ...authority, scheme: match[1].toLowerCase() };
}
/** Host and Origin can reject a loopback peer, but can never authorize a remote peer. */
export function checkTransportFence(req, trusted = []) {
    const remote = req.socket?.remoteAddress;
    if (!isLoopbackRemoteAddress(remote)) {
        return { ok: false, reason: `non-loopback peer: ${remote ?? "unknown"}` };
    }
    const hostHeader = req.headers?.host;
    if (typeof hostHeader !== "string" || hostHeader === "") {
        return { ok: false, reason: "missing Host header" };
    }
    const parsed = parseAuthorityFromHeader(hostHeader);
    if (parsed === null)
        return { ok: false, reason: `unparseable Host: ${hostHeader}` };
    const ip = parsed.host.startsWith("[") ? parsed.host.slice(1, -1) : parsed.host;
    if (parsed.host === "localhost" || isLoopbackRemoteAddress(ip))
        return { ok: true };
    for (const entry of trusted) {
        if (entry.host !== parsed.host || (entry.port !== null && entry.port !== parsed.port))
            continue;
        const origin = req.headers?.origin;
        if (entry.scheme !== null && origin !== undefined && parseOrigin(origin)?.scheme !== entry.scheme)
            continue;
        return { ok: true };
    }
    return { ok: false, reason: `Host not trusted: ${hostHeader}` };
}
/** Browser POSTs must be same-origin; requests without Origin still need the DSH guard and fence. */
export function isSameOriginRequest(req) {
    const rawOrigin = req.headers?.origin;
    if (rawOrigin === undefined)
        return true;
    const origin = parseOrigin(rawOrigin);
    const host = parseAuthorityFromHeader(req.headers?.host);
    if (origin === null || host === null || origin.host !== host.host)
        return false;
    const defaultPort = origin.scheme === "https" ? 443 : 80;
    return (origin.port || defaultPort) === (host.port || defaultPort);
}
/** Capabilities are signed for one device and one selection generation. */
export class StreamAccessController {
    #generation = randomBytes(16).toString("base64url");
    key;
    ttlMs;
    constructor({ key, ttlMs = TOKEN_TTL_MS }) {
        this.key = key;
        this.ttlMs = ttlMs;
    }
    revoke() {
        this.#generation = randomBytes(16).toString("base64url");
    }
    mint(deviceId) {
        const payload = JSON.stringify([deviceId, Date.now() + this.ttlMs, this.#generation]);
        const mac = createHmac("sha256", this.key).update(payload).digest("base64url");
        return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
    }
    verify(token) {
        if (typeof token !== "string" || token === "")
            return { ok: false, reason: "missing token" };
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
            return { ok: false, reason: "malformed token" };
        const [payloadB64, providedMac] = token.split(".");
        const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
        const expectedMac = createHmac("sha256", this.key).update(payload).digest("base64url");
        if (!timingSafeEqual(Buffer.from(providedMac), Buffer.from(expectedMac))) {
            return { ok: false, reason: "bad signature" };
        }
        let fields;
        try {
            fields = JSON.parse(payload);
        }
        catch {
            return { ok: false, reason: "malformed payload" };
        }
        if (!Array.isArray(fields) || fields.length !== 3)
            return { ok: false, reason: "malformed payload" };
        const [deviceId, expiresAt, generation] = fields;
        if (typeof deviceId !== "string" || deviceId === "")
            return { ok: false, reason: "empty device id" };
        if (!Number.isSafeInteger(expiresAt))
            return { ok: false, reason: "malformed expiry" };
        if (generation !== this.#generation)
            return { ok: false, reason: "token revoked" };
        if (Date.now() >= expiresAt)
            return { ok: false, reason: "token expired" };
        return { ok: true, deviceId, expiresAt };
    }
}
//# sourceMappingURL=access.js.map