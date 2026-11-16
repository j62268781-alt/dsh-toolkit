# Self-hosted Server (dsh-toolkit · vendored)

**English** · [中文](README.zh.md)

A single-account, single-process DSH Remote Server: device registration and credential refresh, the Control channel, WebRTC (LAN / P2P) coordination, end-to-end encrypted Relay, and the **device-pairing v1** QR pairing flow added in this directory.

> **Provenance**: this directory is vendored from [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) (MIT, v0.6.5) with device-pairing v1 added (`src/pairing.ts`). The protocol layer is synced to upstream v0.6.5: `src/protocol/{binary-upload,lan-upload}.ts` (`workspace.upload.binary.v1`, `workspace.upload.lan.v1`), the async compaction contract (`harness.remote.compaction.submit|status|cancel`, `remote.compaction.async.v1`) and the `remote.session.events.v1` capability. The only local deviations are the two relaxed schemas for `deviceId` / `platform` (see "Differences from upstream"). Upstream ships as a pnpm workspace; here it is a standalone npm package: the protocol sources live in `src/protocol/`, the only runtime dependencies are `ws` and `zod`. The upstream React admin UI is vendored into `web/` and bundled into `dist/public` by `npm run build` (see "Web admin UI"). See [LICENSE](LICENSE).

## What it is for

A desktop DSH plugin (Host) and a phone (Client) need one always-on service for three things:

1. **Pairing** — the desktop shows a QR code, the phone scans it, the phone shows an 8-digit code, the user types that code into the desktop, and both sides receive credentials (device-pairing v1).
2. **Signaling** — negotiate a direct WebRTC link (LAN / P2P), falling back to Relay when traversal fails.
3. **Relay** — forward end-to-end encrypted control frames when no direct path exists (the Server only ever sees ciphertext).

The Server stores no plaintext credentials: the state file holds only SHA-256 token digests, and web sessions use HttpOnly cookies.

## Quick start (local)

Requires Node.js >= 22.

```bash
cd server
npm install && npm run build && npm start
```

`npm run build` does two things: `tsc` compiles the server into `dist/`, and `vite build` bundles the admin UI into `dist/public/`. `npm run dev` runs the same entry point through `tsx watch` without compiling (run a build once so the UI exists).

Minimal configuration (everything else is optional):

```bash
export DSH_SERVER_ACCOUNT=owner@example.com
export DSH_SERVER_PASSWORD='replace-with-a-long-random-password'   # at least 12 characters
npm start
```

After a build, `GET /` serves the admin UI (`/app/login` to sign in, `/app/remote` for the device list), and the human-readable pairing guide lives at `/pair`. <http://127.0.0.1:8080/healthz> answers `{"status":"ok"}` for liveness checks. Web assets are read into memory at startup, client routes fall back to `index.html`, and `/assets/*` is served with a one-year `immutable` cache.

## Web admin UI

The admin UI is the upstream `web/` app (React + antd 5 + Vite), vendored unchanged apart from the pairing copy; styling reuses the official site front end (provenance in [`web/UPSTREAM.md`](web/UPSTREAM.md)). The Server hosts the build directly, so no separate static site is needed:

| Route | Content |
| --- | --- |
| `/` | Landing page: product intro, "开始使用" entry, light/dark toggle. |
| `/app/login` | Account + password login (`DSH_SERVER_ACCOUNT` / `DSH_SERVER_PASSWORD`), 8-hour HttpOnly cookie session. |
| `/app/remote` | Device list: **every** device registered on this Server (name, online state, role, platform, plugin version, Harness version) with inline rename, refresh and sign-out. |

Notes:

- The login credential is the one global account; there are no separate users, and the page can list and rename every device, so only expose it on a trusted network or behind access control. Devices still unbind themselves with `DELETE /api/v1/devices/self`; like upstream there is no "kick" button.
- Rename calls `POST /api/v1/devices/{id}/name`; the desktop panel and the phone pick the new name up on their next refresh.
- `DSH_SERVER_WEB_ROOT` points at a different build directory if you want to ship your own; when it is missing every page answers 404 `METHOD_NOT_FOUND` while the API keeps working.
- QR pairing and the device list are independent: phone and desktop each get a device token from pairing, and the admin UI is only for looking at and renaming devices.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_SERVER_ACCOUNT` | none (required) | Account identifier for the single-account model, e.g. an email address. |
| `DSH_SERVER_PASSWORD` | none (required) | Account password, **at least 12 characters**. Changing it invalidates every existing device credential. |
| `DSH_SERVER_PUBLIC_URL` | falls back to `http://localhost:<port>` | Origin clients actually use, e.g. `https://remote.example.com`. Drives origin checks; never a container-internal address or a path. **Set it explicitly** — the fallback only works for local debugging. |
| `DSH_SERVER_HOST` | `127.0.0.1` | Listen address. Loopback by default; set `0.0.0.0` inside a container or when exposing the port. |
| `DSH_SERVER_PORT` | `8080` | Listen port. |
| `DSH_SERVER_DATA_FILE` | `./data/state.json` | State file (devices, token digests, account verifier), written 0600 in a 0700 directory. |
| `DSH_SERVER_WEB_ROOT` | `dist/public` | Static directory for the admin UI; only needed when serving a different build. A missing directory answers 404 `METHOD_NOT_FOUND` and leaves the API untouched. |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | empty | Comma-separated trusted reverse-proxy IP literals. When set, every request must carry exactly one `X-Forwarded-For` header holding a single IP literal, else 400. When empty the header is ignored and limits use the socket address. Bare IPv4/IPv6 only: ports, CIDR ranges and hostnames fail startup. |
| `DSH_SERVER_HELLO_TIMEOUT_MS` | `5000` | WebSocket hello deadline (1000-60000). Raise it for cellular cold starts. |
| `DSH_SERVER_HEARTBEAT_INTERVAL_MS` | `25000` | Heartbeat interval (5000-120000). Doubles as NAT/LB keepalive. |
| `DSH_SERVER_HEARTBEAT_DISCONNECT_MS` | `75000` | Heartbeat disconnect threshold (600000 max, at least 2× the interval). |
| `DSH_SERVER_MAX_FRAMES_PER_SEC` | `512` | Control frames per second per connection (64-65536). Exceeding it throws `RATE_LIMITED`, which **closes the socket** with 4001 — a busy agent can look like a dead network. |
| `DSH_SERVER_SLOW_CONSUMER_BYTES` | `16777216` | Socket backlog that marks a peer as gone (`SLOW_CONSUMER`; 1 MiB-64 MiB). Frames are up to 1 MiB, so a brief cellular stall must not close the socket; worst-case memory is this limit per connection. |
| `DSH_SERVER_FORCE_TERMINATE_GRACE_MS` | `1000` | Grace period before a half-closed socket is force-terminated (100-10000). |
| `DSH_SERVER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`. |
| `DSH_SERVER_STUN_URLS` | empty | Comma-separated STUN URLs. Empty means only same-LAN sessions connect directly and everything else goes through Relay; `.env.example` ships a tested mainland-China public list. |
| `DSH_SERVER_TRANSPORTS` | `lan,relay` | Transports advertised to peers; `relay` is always kept. `p2p` needs hole punching, which carrier CGNAT usually blocks — a failed attempt costs a 12s WebRTC deadline before the Relay is used, so it stays off by default; enable it as `lan,p2p,relay` when both ends have a public address (public IPv6). `turn` requires a TURN server of your own and is not covered here. |

Out-of-range optional values log one warning and fall back to the default, so startup still succeeds; missing or invalid `ACCOUNT` / `PASSWORD` fail startup, and an unset `PUBLIC_URL` falls back to `http://localhost:<port>`. See [.env.example](.env.example) for the annotated list.

## Endpoints

Unauthenticated:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health`, `/healthz`, `/ready` | `{"status":"ok"}`. |
| GET | `/pair` | Pairing guidance page (no scripts, `no-store`, strict CSP). |
| GET | `/api/v1/auth/oauth/providers` | `{"capabilities":{"devicePairing":"dsh-pairing-v1","devicePairingQr":"fragment-ticket-v1"},"items":[]}`. The desktop client uses `devicePairingQr === 'fragment-ticket-v1'` to render the short QR form `<origin>/pair#v1.<scanSecret>`. |
| GET | `/api/v1/device-pairing/capabilities` | Same capabilities payload. |
| POST | `/api/v1/device-pairing/sessions` | Create a session, `{v:1, device:{role:'host',...}}`. |
| POST | `/api/v1/device-pairing/resolve` | `{ticket}` → reuse a `state=created` session. |

Pairing session actions (all require `X-DSH-Pairing-Proof` except creation and `resolve`):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/device-pairing/sessions/{id}/claim` | Phone submits `{scanSecret, device:{role:'client',...}}` and receives the 8-digit code. |
| POST | `/api/v1/device-pairing/sessions/{id}/host/status` | Host-side status, including `submissionId` and credentials. |
| POST | `/api/v1/device-pairing/sessions/{id}/mobile/status` | Phone-side status; `submissionId` is always `null`. |
| POST | `/api/v1/device-pairing/sessions/{id}/host/confirm` | `{submissionId, verificationCode}`; on success registers both devices and issues tokens in one transaction. |
| POST | `/api/v1/device-pairing/sessions/{id}/host/cancel` | Cancel the session. |
| POST | `/api/v1/device-pairing/sessions/{id}/mobile/cancel` | Cancel the session. |

Unbind propagation: a successful pairing records the Host ↔ phone relation in the state file (`pairs`). `DELETE /api/v1/devices/self` on either end revokes the other end too — without it, removing the device in DSH-Go would leave the desktop showing "connected". The Host sees `4004 DEVICE_REVOKED`, clears its local credentials and its panel reports that authorization was removed; scanning a fresh QR pairs again (a revoked slot can be re-claimed by the same identity).

Account and device routes (unchanged from upstream):

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | Email + password → 8-hour HttpOnly cookie and an account token; 20 requests/minute per IP. |
| GET | `/api/v1/auth/me` | Cookie session. |
| POST | `/api/v1/auth/logout` | Cookie session. |
| GET | `/api/v1/account/devices` | Cookie session; lists every device. |
| POST | `/api/v1/devices/register` | Account token; registers a device. |
| POST | `/api/v1/devices/register-owned-role` | Device token; registers the counterpart device with the opposite role. |
| POST | `/api/v1/auth/refresh` | `{deviceId, refreshToken}`; rotates and recovers from a lost response. |
| DELETE | `/api/v1/devices/self` | Device token; ends the pairing: revokes itself **and its paired peer**, closing both sockets with `4004 DEVICE_REVOKED` and returning `{status:'revoked',peers:[...]}`. |
| GET | `/api/v1/me` | Device token; returns its own descriptor. |
| GET | `/api/v1/devices` | Client device token; lists available Hosts. |
| GET | `/api/v1/devices/{id}`, `/presence` | Subscribe to its own device, or read presence of same-account devices. |
| POST | `/api/v1/devices/{id}/name` | Account token; rename. |
| WS | `/ws/v1/connect` | Control channel (hello → hello.ack, heartbeat, connect, signal, relay, ping). |

Every `/api/v1/*` request also shares a 240/minute/IP budget and returns 429 `RATE_LIMITED` when exceeded. Errors are always `{"error":{"code","message","requestId","retryable"}}`.

## device-pairing v1 state machine

```
created --claim--> claimed --host/confirm(correct code)--> approved --> completed
   |                  |                                        |
   |                  +--host/confirm(wrong code)--> failed    +--registration failure--> failed
   +--cancel--> cancelled                created/claimed --cancel--> cancelled
   any active state past expiresAt --> expired
```

- A session lives for **180 seconds** (`expiresAt = created + 180000`) and stays recoverable until `recoverUntil = expiresAt + 300000`; after that the Server answers 404 `PAIRING_NOT_FOUND`.
- Each session owns an X25519 key pair. `serverPublicKey`, `scanSecret` and device `identityKey` are all 32-byte **unpadded base64url, 43 characters**.
- The verification code is 8 decimal digits with leading zeros preserved (from `crypto.randomInt`). One wrong code sets `state=failed` with `failureReason=verification_failed` (HTTP 200) and burns the attempt without disclosing the expected value.
- A successful `confirm` registers the Host and the phone in the same transaction and issues one token pair per device: `account=dsh-device:<uuid>`, `accountKind=device_only`, `pairingRestricted=true`, with `inboundOnly=true` for the Host and `false` for the phone. Any failure after the code is verified ends in `state=failed` with a stable `failureReason` and never leaves half-issued tokens behind.
- Idempotency: replaying the **same** `submissionId` with byte-identical body returns the same credentials; a different `submissionId` returns 409 `PAIRING_ATTEMPT_USED`.

Request bodies are capped at **8192 bytes** (413 `FRAME_TOO_LARGE`) and must be strict JSON: duplicate keys, invalid UTF-8, unknown fields and missing fields all return 422 `INVALID_MESSAGE`. Endpoints that take no data require `{}`.

## Pairing proofs

Every pairing endpoint except creation and `resolve` requires:

```
X-DSH-Pairing-Proof: base64url(HMAC-SHA256(proofKey, UTF8("POST\n" + exactPath + "\n" + lowercaseHex(SHA256(UTF8(rawBodyText))))))
```

where `proofKey = HKDF-SHA256(ikm = X25519(session private key, peer identityKey), salt = UTF8(sessionId), info = UTF8("dsh-pairing-v1/" + side), L = 32)`, `side` is `host` or `mobile`, and `exactPath` is the real request pathname (for example `/api/v1/device-pairing/sessions/<id>/claim`). Any failure is 403 `PAIRING_FORBIDDEN` and never explains why.

## Docker

```bash
cd server
cp .env.example .env
# set at least DSH_SERVER_ACCOUNT / DSH_SERVER_PASSWORD / DSH_SERVER_PUBLIC_URL
docker compose up -d --build server
```

- The image builds with `npm ci` + `npm run build` and ships only `dist/`, production `node_modules` and the manifest; it runs as the non-root `node` user.
- Inside the container `DSH_SERVER_HOST=0.0.0.0` and `DSH_SERVER_DATA_FILE=/data/state.json`; the `server-data` volume keeps devices across `docker compose down` (but not `down -v`).
- Health check: `/healthz` every 30 seconds.
- Put an HTTPS reverse proxy in front in production; never expose the Node port directly. `DSH_SERVER_PUBLIC_URL` must match the browser origin exactly (scheme and port included) or static assets and origin checks fail.
- After editing `.env`, apply it with `docker compose up -d --force-recreate server`; `docker compose restart` does not reload environment variables.

## Production deployment (systemd + reverse proxy)

Docker is only one option. `deploy/` ships templates for a bare-metal/VM install: systemd unit, environment file, Caddy or Nginx reverse proxy, .

- Step-by-step guide (Chinese): [`deploy/DEPLOY.zh.md`](deploy/DEPLOY.zh.md)
- [`deploy/dsh-server.service`](deploy/dsh-server.service) — systemd unit (non-root, `ProtectSystem=strict`, `Restart=always`)
- [`deploy/env.example`](deploy/env.example) — `/etc/dsh-toolkit-server.env`
- [`deploy/Caddyfile`](deploy/Caddyfile), [`deploy/nginx.conf`](deploy/nginx.conf) — reverse proxies with WebSocket upgrade and a single-value `X-Forwarded-For` (Caddy does this by default; Nginx template sets it explicitly)

Key points: keep the Server on `127.0.0.1:8080` and expose only the proxy's 443; `DSH_SERVER_PUBLIC_URL` must match the exact origin phones use; when the proxy runs on the same host, set `DSH_SERVER_TRUSTED_PROXY_IPS=127.0.0.1`.

## Tests

```bash
npm install
npm run build
npm test          # vitest run — real HTTP servers on port 0, fully offline
```

Coverage: account/device authorization and credential rotation recovery, Control frame validation and Relay routing, WebRTC signaling, reverse-proxy rate limiting, hello timeout and gateway state machine, log redaction, configuration normalization, admin UI hosting (SPA fallback, MIME types, immutable caching, 404 without a build), and the full device-pairing v1 flow (create → claim → wrong code → correct confirm → both credential sets usable, idempotent replay, expiry, proof failures, oversized bodies, invalid identityKeys, resolve 404).

`tests/pairing-compat.test.ts` additionally uses the upstream `fixtures/pairing/v1/proof.json` (generated with Python `cryptography`, verified independently with NSec) as external ground truth: it proves the proof algorithm byte for byte, replays the published host/mobile/confirm proofs against the real endpoints, and parses every response with zod schemas copied verbatim from the official `pairing-contract.ts` (all `.strict()`, so no extra fields).

## Compatibility with the official clients

The implementation follows the actual parsing logic in `packages/plugin/src/{host-pairing,pairing-contract,server-api}.ts`, deliberately matching: the capability field names and values, the QR text `<origin>/pair#v1.<scanSecret>`, the proof algorithm and its `POST\n{path}\n{sha256hex}` concatenation, the strict response field sets (`submissionId` only on the Host side), the `expiresAt <= now + 240000` check, and treating a 404 from `/api/v1/auth/oauth/providers` as "pairing unsupported" (this Server always returns 200).

Known deviations and risks:

- **`deviceId` and `platform` validation is relaxed** in `src/protocol/index.ts`. Upstream accepts only ULID/UUID ids and `^[a-z0-9][a-z0-9._-]*$` platforms; the pairing protocol allows any 1..128 identifier and mixed-case platform names (`macOS`, `iOS`). Official clients send UUIDv7 plus lowercase platforms, so neither direction breaks them — the relaxation only lets third-party clients register.
- **Error codes**: proof failures return 403 `PAIRING_FORBIDDEN` here (the protocol doc names 401 `PAIRING_PROOF_INVALID`; the doc allows either), and bodies over 8192 bytes return 413 `FRAME_TOO_LARGE` (the doc names 422 `INVALID_MESSAGE`).
- **Device registration precedes token issuance**: `confirm` re-runs the store's device checks (256-device cap, immutable identity, revoked devices cannot return). An invalid descriptor therefore ends the session as `state=failed` with `failureReason=PAIRING_DEVICE_CONFLICT` instead of issuing partial credentials.
- **`dsh-Go`**: this checkout of upstream contains no Dart client (`packages/dsh_remote` is not implemented yet), so the phone side was validated against the protocol document and the desktop client's parsing logic only — no on-device integration test.

Not done: upstream test scenarios that need the client stack (Noise, WebRTC, the Plugin HTTP client) are not ported — equivalent behaviour is asserted at the raw HTTP/WebSocket level instead. The admin UI is covered by build/hosting checks and a manual click-through, not by front-end unit tests.

## Layout

```
server/
├── src/
│   ├── main.ts        # env parsing, startup, graceful shutdown
│   ├── server.ts      # HTTP routing, origin checks, rate limits, static fallback
│   ├── pairing.ts     # device-pairing v1 (new)
│   ├── gateway.ts     # WebSocket control channel, Relay, WebRTC signaling
│   ├── store.ts       # device and token-digest persistence, rotation and recovery
│   ├── config.ts      # environment parsing and normalization
│   ├── ice.ts         # STUN configuration (TURN code kept, not advertised by default)
│   ├── logger.ts      # single-line JSON logs with redaction
│   └── protocol/      # vendored from upstream packages/protocol
├── web/               # vendored upstream React admin UI (vite builds it into dist/public)
├── tests/             # vitest: server / web / pairing / pairing-compat / refresh-recovery
├── Dockerfile, compose.yaml, .env.example
├── deploy/            # systemd unit, env file, Caddy/Nginx, DEPLOY.zh.md
├── LICENSE            # upstream MIT
└── README.md / README.zh.md
```

## License

MIT, see [LICENSE](LICENSE). Upstream copyright belongs to the *DSH Remote contributors*; this directory adds device-pairing v1 (`src/pairing.ts` and related wiring) and the standalone-package changes described above.
