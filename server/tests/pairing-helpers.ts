import { createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, type KeyObject } from 'node:crypto'

/**
 * Minimal device-side implementation of the pairing v1 cryptography, used by the
 * tests to talk to the server exactly like `host-pairing.ts` / `device_pairing.dart`
 * do: ephemeral X25519 identity, HKDF over the shared secret and an HMAC over the
 * request line plus the SHA-256 of the exact body bytes.
 */

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

export interface DeviceKeys {
  privateKey: KeyObject
  identityKey: string
}

export function deviceKeys(): DeviceKeys {
  const pair = generateKeyPairSync('x25519')
  const der = pair.publicKey.export({ format: 'der', type: 'spki' })
  return { privateKey: pair.privateKey, identityKey: Buffer.from(der).subarray(-32).toString('base64url') }
}

export function serverKeyObject(serverPublicKey: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(serverPublicKey, 'base64url')]),
    format: 'der',
    type: 'spki',
  })
}

export function proofKey(privateKey: KeyObject, serverPublicKey: string, sessionId: string, side: 'host' | 'mobile'): Buffer {
  const shared = diffieHellman({ privateKey, publicKey: serverKeyObject(serverPublicKey) })
  return Buffer.from(hkdfSync('sha256', shared, Buffer.from(sessionId, 'utf8'), Buffer.from(`dsh-pairing-v1/${side}`, 'utf8'), 32))
}

/** `base64url(HMAC-SHA256(proofKey, "POST\\n<path>\\n<sha256hex(body)>"))`. */
export function pairingProof(
  privateKey: KeyObject,
  serverPublicKey: string,
  sessionId: string,
  side: 'host' | 'mobile',
  path: string,
  bodyText: string,
): string {
  const digest = createHash('sha256').update(bodyText, 'utf8').digest('hex')
  return createHmac('sha256', proofKey(privateKey, serverPublicKey, sessionId, side))
    .update(`POST\n${path}\n${digest}`, 'utf8').digest('base64url')
}
