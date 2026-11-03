/**
 * Multi-frame zstd JSONL reader for DSH session logs.
 *
 * A session log is several zstd frames concatenated: the first frame holds the
 * one-line session header, later frames hold JSONL event lines. Node's
 * `zstdDecompressSync` only decodes the FIRST frame of a concatenated buffer, so
 * the frames are located by scanning for the zstd magic bytes and each frame is
 * decompressed separately.
 *
 * Robustness: a "magic" sequence can occur inside compressed payload by chance.
 * When a candidate frame does not decompress, the scan extends the frame end to
 * the following candidate instead of losing the rest of the file. Unrecoverable
 * segments and unparsable JSON lines are reported, never thrown to the caller.
 */
import { readFile, stat } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";

/** Zstandard frame magic bytes (little-endian 0xFD2FB528). */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Logs larger than this are skipped and served from the projection cache instead. */
export const MAX_LOG_BYTES = 64 * 1024 * 1024;

/** Upper bound on candidate extension attempts per frame, keeping corrupt files cheap. */
const MAX_EXTENSIONS = 64;

/**
 * Epoch offsets of every zstd magic-byte sequence in a buffer.
 * @param {Buffer} buffer
 * @returns {number[]}
 */
export function findFrameOffsets(buffer) {
  const offsets = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < ZSTD_MAGIC.length) return offsets;
  let index = buffer.indexOf(ZSTD_MAGIC);
  while (index !== -1) {
    offsets.push(index);
    index = buffer.indexOf(ZSTD_MAGIC, index + ZSTD_MAGIC.length);
  }
  return offsets;
}

/**
 * Decompress every zstd frame of a concatenated buffer, tolerating bad segments.
 * @param {Buffer} buffer
 * @returns {{texts:string[], frames:number, errors:string[]}}
 */
export function decompressFrames(buffer) {
  const offsets = findFrameOffsets(buffer);
  const texts = [];
  const errors = [];
  let index = 0;
  while (index < offsets.length) {
    const start = offsets[index];
    let decoded = null;
    let next = index + 1;
    const limit = Math.min(offsets.length, index + MAX_EXTENSIONS);
    for (let attempt = index + 1; attempt <= limit; attempt += 1) {
      // The last frame always runs to the end of the file; a truncated trailing
      // frame is ignored by zstd, so EOF is an acceptable boundary.
      const end = attempt < offsets.length ? offsets[attempt] : buffer.length;
      try {
        decoded = zstdDecompressSync(buffer.subarray(start, end));
        next = attempt;
        break;
      } catch {
        // False positive magic inside a frame, or a genuinely corrupt frame:
        // extend to the next candidate boundary before giving up.
      }
    }
    if (decoded === null) {
      errors.push(`zstd frame at byte ${start} could not be decompressed`);
      index += 1;
      continue;
    }
    texts.push(decoded.toString("utf8"));
    index = next;
  }
  return { texts, frames: texts.length, errors };
}

/**
 * Parse concatenated JSONL text fragments, skipping blank and malformed lines.
 * @param {string[]} texts
 * @returns {{events:unknown[], badLines:number}}
 */
export function parseJsonLines(texts) {
  const events = [];
  let badLines = 0;
  for (const text of texts) {
    for (const line of String(text).split("\n")) {
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.trim() === "") continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        badLines += 1;
      }
    }
  }
  return { events, badLines };
}

/**
 * Decode a session-log buffer into JSON events.
 * @param {Buffer|string} input
 * @param {{compressed?: boolean}} [options] `compressed` forces the zstd path;
 *   when omitted, zstd is assumed only when the buffer starts with the magic.
 * @returns {{events:unknown[], frames:number, badLines:number, errors:string[]}}
 */
export function decodeSessionLog(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? "");
  if (buffer.length === 0) return { events: [], frames: 0, badLines: 0, errors: [] };
  const compressed = options.compressed ?? buffer.subarray(0, ZSTD_MAGIC.length).equals(ZSTD_MAGIC);
  let texts;
  let errors = [];
  let frames = 0;
  if (compressed) {
    const decoded = decompressFrames(buffer);
    texts = decoded.texts;
    errors = decoded.errors;
    frames = decoded.frames;
  } else {
    texts = [buffer.toString("utf8")];
    frames = 1;
  }
  const { events, badLines } = parseJsonLines(texts);
  return { events, frames, badLines, errors };
}

/**
 * Read and decode one session log. Throws only when the file itself cannot be
 * read; oversized files raise an error tagged `code === "EOVERSIZE"` so callers
 * can fall back to the projection cache.
 * @param {string} path
 * @param {{size?: number, maxBytes?: number}} [options] `size` avoids a second stat.
 * @returns {Promise<{events:unknown[], frames:number, badLines:number, errors:string[], size:number, mtimeMs:number}>}
 */
export async function readSessionLog(path, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_LOG_BYTES;
  let size = options.size;
  let mtimeMs = options.mtimeMs;
  if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) {
    const info = await stat(path);
    size = info.size;
    mtimeMs = info.mtimeMs;
  }
  if (size > maxBytes) {
    const error = new Error(`session log is ${size} bytes, above the ${maxBytes}-byte limit`);
    error.code = "EOVERSIZE";
    throw error;
  }
  const buffer = await readFile(path);
  const decoded = decodeSessionLog(buffer, { compressed: path.endsWith(".zstd") });
  return {
    ...decoded,
    size,
    mtimeMs,
    // The header frame is a single line; surface bad lines as tolerated warnings.
    badLines: decoded.badLines,
  };
}
