'use strict'
const { execFile } = require('node:child_process')
const path = require('node:path')

// NSScreen auxiliary regions are the usable areas beside the camera housing.
// A menu bar gap is deliberately not evidence of a notch.
function notchForDisplay(display, screens = []) {
  const native = screens.find(item => item.id === display.id)
  if (!native || !native.left || !native.right) return null
  const { frame, left, right, safeTop } = native
  if (![frame?.x, frame?.y, frame?.width, frame?.height, left.x, left.width, left.height, right.x, right.width, right.height, safeTop].every(Number.isFinite)) return null
  const x = left.x + left.width - frame.x
  const width = right.x - left.x - left.width
  if (safeTop < 20 || safeTop > 100 || left.width <= 0 || right.width <= 0 || width < 60 || width > 600 || x < 0 || x + width > frame.width || Math.abs(frame.width - display.bounds.width) > 2 || Math.abs(frame.height - display.bounds.height) > 2 || Math.abs(left.height - safeTop) > 2 || Math.abs(right.height - safeTop) > 2) return null
  return { x, width, height: safeTop }
}

function queryNativeScreens(platform = process.platform) {
  if (platform !== 'darwin') return Promise.resolve([])
  return new Promise(resolve => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', path.join(__dirname, 'screens.jxa')], { timeout: 2500, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { resolve([]); return }
      try { const value = JSON.parse(stdout); resolve(Array.isArray(value) ? value : []) } catch { resolve([]) }
    })
  })
}
module.exports = { notchForDisplay, queryNativeScreens }
