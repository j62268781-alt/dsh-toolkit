# Self-hosted Server (dsh-toolkit · vendored)

**English** · [中文](README.zh.md)

A single-account, single-process DSH Remote Server: device registration and credential refresh, the Control channel, WebRTC (LAN / P2P / TURN) coordination, end-to-end encrypted Relay, and the **device-pairing v1** QR pairing flow added in this directory.

> **Provenance**: this directory is vendored from [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) (MIT, v0.6.4) with device-pairing v1 added (`src/pairing.ts`). Upstream ships as a pnpm workspace; here it is a standalone npm package: the protocol sources live in `src/protocol/`, the only runtime dependencies are `ws` and `zod`, and the React admin UI (`web/`) and its build step were removed. See [LICENSE](LICENSE).

## What it is for

A desktop DSH plugin (Host) and a phone (Client) need one always-on service for three things:

1. **Pairing** — the desktop shows a QR code, the phone scans it, the phone shows an 8-digit code, the user types that code into the desktop, and both sides receive credentials (device-pairing v1).
2. **Signaling** — negotiate a direct WebRTC link (LAN / P2P / TURN), falling back to Relay when traversal fails.
3. **Relay** — forward end-to-end encrypted control frames when no direct path exists (the Server only ever sees ciphertext).

The Server stores no plaintext credentials: the state file holds only SHA-256 token digests, and web sessions use HttpOnly cookies.

## Quick start (local)

Requires Node.js >= 22.

```bash
cd server
npm install && npm run build && npm start
```

`npm run dev` runs the same entry point through `tsx watch` without compiling.

Minimal configuration (everything else is optional):

```bash
export DSH_SERVER_ACCOUNT=owner@example.com
export DSH_SERVER_PASSWORD='replace-with-a-long-random-password'   # at least 12 characters
npm start
```

Open <http://127.0.0.1:8080/healthz> for `{"status":"ok"}`; the human-readable pairing guide lives at <http://127.0.0.1:8080/pair>. The bundled admin UI is gone, so `GET /` answers 404 `METHOD_NOT_FOUND` — the static/SPA fallback still works, so dropping a build into `dist/public/` restores it.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_SERVER_ACCOUNT` | none (required) | Account identifier for the single-account model, e.g. an email address. |
| `DSH_SERVER_PASSWORD` | none (required) | Account password, **at least 12 characters**. Changing it invalidates every existing device credential. |
| `DSH_SERVER_PUBLIC_URL` | falls back to `http://localhost:<port>` | Origin clients actually use, e.g. `https://remote.example.com`. Drives origin checks and TURN credentials; never a container-internal address or a path. **Set it explicitly** — the fallback only works for local debugging. |
| `DSH_SERVER_HOST` | `127.0.0.1` | Listen address. Loopback by default; set `0.0.0.0` inside a container or when exposing the port. |
| `DSH_SERVER_PORT` | `8080` | Listen port. |
| `DSH_SERVER_DATA_FILE` | `./data/state.json` | State file (devices, token digests, account verifier), written 0600 in a 0700 directory. |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | empty | Comma-separated trusted reverse-proxy IP literals. When set, every request must carry exactly one `X-Forwarded-For` header holding a single IP literal, else 400. When empty the header is ignored and limits use the socket address. Bare IPv4/IPv6 only: ports, CIDR ranges and hostnames fail startup. |
| `DSH_SERVER_HELLO_TIMEOUT_MS` | `5000` | WebSocket hello deadline (1000-60000). |
| `DSH_SERVER_HEARTBEAT_INTERVAL_MS` | `25000` | Heartbeat interval (5000-120000). |
| `DSH_SERVER_HEARTBEAT_DISCONNECT_MS` | `75000` | Heartbeat disconnect threshold (50000-600000, at least 2× the interval). |
| `DSH_SERVER_FORCE_TERMINATE_GRACE_MS` | `1000` | Grace period before a half-closed socket is force-terminated (100-10000). |
| `DSH_SERVER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`. |
| `DSH_SERVER_STUN_URLS` | empty | Comma-separated STUN URLs. Empty keeps Relay-only behaviour. |
| `DSH_SERVER_TURN_URLS` | empty | Comma-separated TURN URLs. |
| `DSH_SERVER_TURN_SECRET` | empty | coturn `static-auth-secret`; the Server issues short-lived credentials and never exposes the secret. |
| `DSH_SERVER_TURN_USERNAME` / `DSH_SERVER_TURN_PASSWORD` | empty | Static TURN credentials — mutually exclusive with `TURN_SECRET`. |
| `DSH_SERVER_TURN_TTL_SECONDS` | `300` | TURN credential lifetime (60-3600). |

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
| DELETE | `/api/v1/devices/self` | Device token; revokes itself and drops its socket. |
| GET | `/api/v1/me` | Device token; returns its own descriptor. |
| GET | `/api/v1/devices` | Client device token; lists available Hosts. |
| GET | `/api/v1/devices/{id}`, `/presence` | Subscribe to its own device, or read presence of same-account devices. |
| POST | `/api/v1/devices/{id}/name` | Account token; rename. |
| GET | `/api/v1/turn/credentials?connection_id=` | Connection participants only; issues short-lived TURN credentials. |
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

## Tests

```bash
npm install
npm run build
npm test          # vitest run — real HTTP servers on port 0, fully offline
```

Coverage: account/device authorization and credential rotation recovery, Control frame validation and Relay routing, WebRTC signaling and TURN credentials, reverse-proxy rate limiting, hello timeout and gateway state machine, log redaction, configuration normalization, and the full device-pairing v1 flow (create → claim → wrong code → correct confirm → both credential sets usable, idempotent replay, expiry, proof failures, oversized bodies, invalid identityKeys, resolve 404).

`tests/pairing-compat.test.ts` additionally uses the upstream `fixtures/pairing/v1/proof.json` (generated with Python `cryptography`, verified independently with NSec) as external ground truth: it proves the proof algorithm byte for byte, replays the published host/mobile/confirm proofs against the real endpoints, and parses every response with zod schemas copied verbatim from the official `pairing-contract.ts` (all `.strict()`, so no extra fields).

## Compatibility with the official clients

The implementation follows the actual parsing logic in `packages/plugin/src/{host-pairing,pairing-contract,server-api}.ts`, deliberately matching: the capability field names and values, the QR text `<origin>/pair#v1.<scanSecret>`, the proof algorithm and its `POST\n{path}\n{sha256hex}` concatenation, the strict response field sets (`submissionId` only on the Host side), the `expiresAt <= now + 240000` check, and treating a 404 from `/api/v1/auth/oauth/providers` as "pairing unsupported" (this Server always returns 200).

Known deviations and risks:

- **`deviceId` and `platform` validation is relaxed** in `src/protocol/index.ts`. Upstream accepts only ULID/UUID ids and `^[a-z0-9][a-z0-9._-]*$` platforms; the pairing protocol allows any 1..128 identifier and mixed-case platform names (`macOS`, `iOS`). Official clients send UUIDv7 plus lowercase platforms, so neither direction breaks them — the relaxation only lets third-party clients register.
- **Error codes**: proof failures return 403 `PAIRING_FORBIDDEN` here (the protocol doc names 401 `PAIRING_PROOF_INVALID`; the doc allows either), and bodies over 8192 bytes return 413 `FRAME_TOO_LARGE` (the doc names 422 `INVALID_MESSAGE`).
- **Device registration precedes token issuance**: `confirm` re-runs the store's device checks (256-device cap, immutable identity, revoked devices cannot return). An invalid descriptor therefore ends the session as `state=failed` with `failureReason=PAIRING_DEVICE_CONFLICT` instead of issuing partial credentials.
- **`dsh-Go`**: this checkout of upstream contains no Dart client (`packages/dsh_remote` is not implemented yet), so the phone side was validated against the protocol document and the desktop client's parsing logic only — no on-device integration test.

Not done: the upstream `web/` admin UI is removed (`GET /` answers 404 `METHOD_NOT_FOUND`; only `/pair` serves the script-free guide page, so there is no SPA), and upstream test scenarios that need the client stack (Noise, WebRTC, the Plugin HTTP client) are not ported — equivalent behaviour is asserted at the raw HTTP/WebSocket level instead.

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
│   ├── ice.ts         # STUN/TURN configuration and short-lived credentials
│   ├── logger.ts      # single-line JSON logs with redaction
│   └── protocol/      # vendored from upstream packages/protocol
├── tests/             # vitest: server / pairing / pairing-compat / refresh-recovery
├── Dockerfile, compose.yaml, .env.example
├── LICENSE            # upstream MIT
└── README.md / README.zh.md
```

## License

MIT, see [LICENSE](LICENSE). Upstream copyright belongs to the *DSH Remote contributors*; this directory adds device-pairing v1 (`src/pairing.ts` and related wiring) and the standalone-package changes described above.
