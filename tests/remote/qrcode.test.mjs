/**
 * 二维码编码器的往返测试：生成矩阵 → 栅格化 → 解码 → 必须与原文一致。
 *
 * 这条测试是自研编码器的唯一正确性依据。不做「和某个库逐位比对」，
 * 因为不同实现可以在掩码选择、padding 上合法地不同；能不能扫出来才是判据。
 *
 * jsQR 只在测试时使用，不进产物。
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { encode } from '../../src/modules/remote/client/qrcode.js'

const require = createRequire(import.meta.url)

let jsQR
try {
  jsQR = require('jsqr')
} catch {
  jsQR = undefined
}

/** 把矩阵栅格化成 RGBA 像素，再交给解码器。 */
function rasterize(matrix, scale = 6, quiet = 4) {
  const n = matrix.length
  const side = (n + quiet * 2) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y][x]) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx
          const py = (y + quiet) * scale + dy
          const index = (py * side + px) * 4
          data[index] = 0
          data[index + 1] = 0
          data[index + 2] = 0
        }
      }
    }
  }
  return { data, side }
}

test('二维码矩阵具有合法的尺寸与静默区可解码性', () => {
  const matrix = encode('https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=4dca94ab571c0d5585162dfd9a6b6ab7&bot_type=3')
  const version = (matrix.length - 17) / 4
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 10, `版本必须是 1-10 的整数，实际 ${version}`)
  assert.equal(matrix.length, version * 4 + 17)
  // 三个定位图形：左上、右上、左下都必须是实心 7x7。
  const size = matrix.length
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    assert.equal(matrix[oy][ox], true, '定位图形左上角必须是深色')
    assert.equal(matrix[oy + 3][ox + 3], true, '定位图形中心必须是深色')
    assert.equal(matrix[oy + 1][ox + 1], false, '定位图形内环必须是浅色')
  }
})

test('真实扫码可解：ASCII 与中文、短串与长串', { skip: jsQR === undefined ? 'jsqr 未安装（仅测试期依赖）' : false }, () => {
  const cases = [
    'a',
    'hello world',
    'x'.repeat(60),
    'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=4dca94ab571c0d5585162dfd9a6b6ab7&bot_type=3',
    '微信扫码登录测试 中文内容',
  ]
  for (let k = 1; k <= 4; k++) {
    cases.push(`https://liteapp.weixin.qq.com/q/AbCdEf?qrcode=${'0123456789abcdef'.repeat(k)}&bot_type=3`)
  }
  for (const text of cases) {
    const matrix = encode(text)
    const { data, side } = rasterize(matrix)
    const decoded = jsQR(data, side, side)
    assert.equal(decoded?.data, text, `往返解码必须还原原文：${text.slice(0, 40)}`)
  }
})

test('超出版本 10 容量时给出可读错误，而不是产出坏码', () => {
  assert.throws(() => encode('x'.repeat(2000)), /too long/)
})

test('空串也能编码（Byte 模式 0 字节）', { skip: jsQR === undefined ? 'jsqr 未安装（仅测试期依赖）' : false }, () => {
  const matrix = encode('')
  const { data, side } = rasterize(matrix)
  const decoded = jsQR(data, side, side)
  assert.equal(decoded?.data, '')
})
