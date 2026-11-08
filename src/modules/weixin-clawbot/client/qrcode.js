/**
 * 二维码编码器（Byte 模式，纠错等级 M，版本 1-10）。纯 JS、零依赖，输出布尔矩阵。
 *
 * 之所以自己实现：浏览器产物必须自包含，不能 import 外部包，也不能依赖原生模块。
 * 正确性由「生成矩阵 → 栅格化 → 解码回原文」的往返测试保证（见 tests/weixin-clawbot/qrcode.test.mjs）。
 */

// Correct ISO/IEC 18004 tables for EC level M, versions 1-10.
const EC_CODEWORDS_PER_BLOCK_M = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16, 7: 18, 8: 22, 9: 22, 10: 26 }
// [ [blocksInGroup1, dataPerBlock1], [blocksInGroup2, dataPerBlock2] ]
const EC_BLOCKS_M = {
  1: [[1, 16]],
  2: [[1, 28]],
  3: [[1, 44]],
  4: [[2, 32]],
  5: [[2, 43]],
  6: [[4, 27]],
  7: [[4, 31]],
  8: [[2, 38], [2, 39]],
  9: [[3, 36], [2, 37]],
  10: [[4, 43], [1, 44]],
}
const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

function totalCodewords(version) {
  return EC_BLOCKS_M[version].reduce((sum, [blocks, data]) => sum + blocks * (data + EC_CODEWORDS_PER_BLOCK_M[version]), 0)
}
function dataCapacityBytes(version) {
  return EC_BLOCKS_M[version].reduce((sum, [blocks, data]) => sum + blocks * data, 0)
}

// ---- GF(256) ----
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generatorPoly(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function reedSolomon(data, ecCount) {
  const gen = generatorPoly(ecCount)
  const result = new Uint8Array(ecCount)
  for (const byte of data) {
    const factor = byte ^ result[0]
    result.copyWithin(0, 1)
    result[ecCount - 1] = 0
    for (let i = 0; i < ecCount; i++) result[i] ^= mul(gen[i + 1], factor)
  }
  return result
}

// ---- bit buffer ----
class Bits {
  constructor() { this.bits = [] }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }
  get length() { return this.bits.length }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8))
    this.bits.forEach((bit, index) => { if (bit) out[index >> 3] |= 0x80 >> (index & 7) })
    return out
  }
}

export function encode(text, { ecLevel = 'M' } = {}) {
  if (ecLevel !== 'M') throw new Error('only EC level M is implemented')
  const bytes = new TextEncoder().encode(text)
  let version = 0
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16
    const needed = 4 + countBits + bytes.length * 8
    if (needed <= dataCapacityBytes(v) * 8) { version = v; break }
  }
  if (version === 0) throw new Error('data too long for versions 1-10 at EC level M')

  const bits = new Bits()
  bits.push(0b0100, 4)
  bits.push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) bits.push(byte, 8)

  const capacityBits = dataCapacityBytes(version) * 8
  const terminator = Math.min(4, capacityBits - bits.length)
  bits.push(0, terminator)
  while (bits.length % 8 !== 0) bits.push(0, 1)
  const padBytes = [0xec, 0x11]
  for (let i = 0; bits.length < capacityBits; i++) bits.push(padBytes[i % 2], 8)

  // ---- split into blocks ----
  const data = bits.toBytes()
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK_M[version]
  const groups = []
  let offset = 0
  for (const [blocks, perBlock] of EC_BLOCKS_M[version]) {
    for (let b = 0; b < blocks; b++) {
      const chunk = data.slice(offset, offset + perBlock)
      offset += perBlock
      groups.push({ chunk, ec: reedSolomon(chunk, ecPerBlock) })
    }
  }
  const maxData = Math.max(...groups.map((g) => g.chunk.length))
  const interleaved = []
  for (let i = 0; i < maxData; i++) for (const g of groups) if (i < g.chunk.length) interleaved.push(g.chunk[i])
  for (let i = 0; i < ecPerBlock; i++) for (const g of groups) interleaved.push(g.ec[i])

  return buildMatrix(version, Uint8Array.from(interleaved))
}

// ---- matrix ----
function buildMatrix(version, codewords) {
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array(size).fill(null))
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))

  const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true }

  // finder patterns + separators
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  // timing patterns
  for (let i = 0; i < size; i++) {
    if (!reserved[6][i]) set(i, 6, i % 2 === 0)
    if (!reserved[i][6]) set(6, i, i % 2 === 0)
  }
  // alignment patterns
  const centers = ALIGNMENT[version]
  for (const cy of centers) {
    for (const cx of centers) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }
  // reserve format areas + dark module
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) { modules[8][i] = false; reserved[8][i] = true }
    if (!reserved[i][8]) { modules[i][8] = false; reserved[i][8] = true }
  }
  for (let i = 0; i < 8; i++) {
    modules[8][size - 1 - i] = false; reserved[8][size - 1 - i] = true
    modules[size - 1 - i][8] = false; reserved[size - 1 - i][8] = true
  }
  modules[size - 8][8] = true
  reserved[size - 8][8] = true
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        modules[size - 11 + j][i] = false; reserved[size - 11 + j][i] = true
        modules[i][size - 11 + j] = false; reserved[i][size - 11 + j] = true
      }
    }
  }

  // data placement
  const bits = []
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  let index = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step
      for (let c = 0; c < 2; c++) {
        const x = right - c
        if (reserved[y][x]) continue
        modules[y][x] = index < bits.length ? bits[index] === 1 : false
        index++
      }
    }
    upward = !upward
  }

  // mask selection
  let best = null
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row) => row.slice())
    applyMask(candidate, mask, reserved)
    drawFormat(candidate, version, mask)
    if (version >= 7) drawVersion(candidate, version)
    const penalty = score(candidate)
    if (best === null || penalty < best.penalty) best = { mask, penalty, matrix: candidate }
  }
  return best.matrix
}

function applyMask(matrix, mask, reserved) {
  const size = matrix.length
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (reserved[y][x]) continue
      let invert = false
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break
        case 1: invert = y % 2 === 0; break
        case 2: invert = x % 3 === 0; break
        case 3: invert = (x + y) % 3 === 0; break
        case 4: invert = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; break
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break
      }
      if (invert) matrix[y][x] = !matrix[y][x]
    }
  }
}

const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 }

function drawFormat(matrix, version, mask) {
  const size = matrix.length
  const data = (EC_FORMAT_BITS.M << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  const bits = ((data << 10) | remainder) ^ 0x5412
  const bit = (i) => ((bits >>> i) & 1) === 1

  // First copy: column 8 (rows 0..5, 7, 8) then row 8 (columns 7 down to 0).
  for (let i = 0; i <= 5; i++) matrix[i][8] = bit(i)
  matrix[7][8] = bit(6)
  matrix[8][8] = bit(7)
  matrix[8][7] = bit(8)
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = bit(i)

  // Second copy: row 8 (columns size-1 .. size-8) then column 8 (rows size-7 .. size-1).
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = bit(i)
  matrix[size - 8][8] = true
}

function drawVersion(matrix, version) {
  const size = matrix.length
  let remainder = version
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  const bits = (version << 12) | remainder
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    matrix[b][a] = dark
    matrix[a][b] = dark
  }
}

function score(matrix) {
  const size = matrix.length
  let penalty = 0

  const runs = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) run++
        else { if (run >= 5) penalty += 3 + (run - 5); run = 1 }
      }
      if (run >= 5) penalty += 3 + (run - 5)
    }
  }
  runs((a, b) => matrix[a][b])
  runs((a, b) => matrix[b][a])

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = matrix[y][x]
      if (v === matrix[y][x + 1] && v === matrix[y + 1][x] && v === matrix[y + 1][x + 1]) penalty += 3
    }
  }

  const pattern1 = [true, false, true, true, true, false, true, false, false, false, false]
  const pattern2 = [false, false, false, false, true, false, true, true, true, false, true]
  const match = (read, start) => {
    let m1 = true, m2 = true
    for (let i = 0; i < 11; i++) {
      const v = read(start + i)
      if (v !== pattern1[i]) m1 = false
      if (v !== pattern2[i]) m2 = false
    }
    return (m1 ? 40 : 0) + (m2 ? 40 : 0)
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + 11 <= size; x++) penalty += match((i) => matrix[y][i], x)
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y + 11 <= size; y++) penalty += match((i) => matrix[i][x], y)
  }

  let dark = 0
  for (const row of matrix) for (const cell of row) if (cell) dark++
  const percent = (dark * 100) / (size * size)
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10
  return penalty
}

/** Render a boolean matrix as an inline SVG string. */
export function toSvg(matrix, { size = 200, margin = 4, dark = '#000', light = '#fff' } = {}) {
  const count = matrix.length
  const quiet = margin
  const total = count + quiet * 2
  const path = []
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (matrix[y][x]) path.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img"><rect width="${total}" height="${total}" fill="${light}"/><path d="${path.join('')}" fill="${dark}"/></svg>`
}
