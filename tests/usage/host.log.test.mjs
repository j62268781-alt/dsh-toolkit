import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zstdCompressSync } from "node:zlib";
import {
  MAX_LOG_BYTES,
  ZSTD_MAGIC,
  decodeSessionLog,
  findFrameOffsets,
  parseJsonLines,
  readSessionLog,
} from "../../src/modules/usage/host/log.js";

const header = {
  type: "session",
  version: 4,
  id: "session-test-1",
  createdAt: 1_793_000_000_000,
  cwd: "D:\\项目\\dsh-toolkit",
  delegationDepth: 0,
};
const events = [
  { type: "turn/start", seq: 0, time: 1_793_000_000_100, data: { turn: 1 } },
  {
    type: "assistant/message",
    seq: 1,
    time: 1_793_000_000_200,
    data: {
      message: { source: { kind: "model", provider: "turing", model: "deepseek-flash" } },
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1_000, cacheWriteTokens: 0, totalTokens: 1_150 },
    },
  },
  { type: "step/end", seq: 2, time: 1_793_000_000_300, data: { turn: 1, step: 1 } },
  { type: "session/title", seq: 3, time: 1_793_000_000_400, data: { title: "Greeting" } },
];

const line = (value) => `${JSON.stringify(value)}\n`;
const frame = (text) => zstdCompressSync(Buffer.from(text));
const multiFrame = (...texts) => Buffer.concat(texts.map(frame));
const validLog = multiFrame(line(header), events.map(line).join(""), line({ type: "turn/end", seq: 4, time: 1_793_000_000_500, data: {} }));

test("multi-frame zstd log decodes the header frame and every event frame", () => {
  const offsets = findFrameOffsets(validLog);
  assert.equal(offsets.length, 3);
  const decoded = decodeSessionLog(validLog);
  assert.equal(decoded.errors.length, 0);
  assert.equal(decoded.frames, 3);
  assert.equal(decoded.badLines, 0);
  assert.equal(decoded.events.length, 6);
  assert.deepEqual(decoded.events[0], header);
  assert.equal(decoded.events[2].data.usage.inputTokens, 100);
  assert.equal(decoded.events[5].type, "turn/end");
});

test("whole-buffer decompression assumption: frames are still split individually", () => {
  // Node only decodes the first frame of a concatenated buffer, so the reader
  // must see the later frames too.
  const decoded = decodeSessionLog(validLog);
  assert.ok(decoded.events.length > 4, "frames after the first must be decoded");
});

test("a corrupt zstd segment is reported and does not lose the later frames", () => {
  const corrupt = Buffer.concat([ZSTD_MAGIC, Buffer.from("this is not a zstd frame payload")]);
  const buffer = Buffer.concat([frame(line(header)), corrupt, frame(line(events[1]))]);
  const decoded = decodeSessionLog(buffer);
  assert.equal(decoded.errors.length, 1);
  assert.match(decoded.errors[0], /could not be decompressed/);
  assert.equal(decoded.events.length, 2);
  assert.equal(decoded.events[1].type, "assistant/message");
});

test("a plain JSONL log is decoded without zstd", () => {
  const plain = Buffer.from(line(header) + events.map(line).join(""));
  const decoded = decodeSessionLog(plain, { compressed: false });
  assert.equal(decoded.frames, 1);
  assert.equal(decoded.events.length, 5);
  assert.equal(decoded.errors.length, 0);
});

test("malformed JSON lines are counted, not thrown", () => {
  const plain = `${line(header)}{not json}\n${line(events[0])}\n\n`;
  const decoded = decodeSessionLog(Buffer.from(plain), { compressed: false });
  assert.equal(decoded.badLines, 1);
  assert.equal(decoded.events.length, 2);
  const parsed = parseJsonLines([]);
  assert.deepEqual(parsed, { events: [], badLines: 0 });
});

test("readSessionLog reads a real file and rejects oversized logs with EOVERSIZE", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-usage-log-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "session.v4.jsonl.zstd");
  await writeFile(path, validLog);

  const decoded = await readSessionLog(path);
  assert.equal(decoded.events.length, 6);
  assert.equal(decoded.size, validLog.length);
  assert.ok(decoded.mtimeMs > 0);

  await assert.rejects(readSessionLog(path, { maxBytes: 10 }), (error) => error.code === "EOVERSIZE");
  assert.ok(MAX_LOG_BYTES > 32 * 1024 * 1024, "default log cap must be generous");
});
