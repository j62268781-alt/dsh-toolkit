import { encode } from './qrcode.js'

/** 把二维码矩阵渲染成一个 path，避免依赖 <canvas> 也不需要 prerender。 */
export function createQrCode(React) {
  const h = React.createElement

  return function QrCode({ url, size = 176, label }) {
    const built = React.useMemo(() => {
      try {
        const matrix = encode(url)
        const count = matrix.length
        const quiet = 4
        const total = count + quiet * 2
        const parts = []
        for (let y = 0; y < count; y++) {
          for (let x = 0; x < count; x++) {
            if (matrix[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
          }
        }
        return { path: parts.join(''), total, error: undefined }
      } catch (error) {
        return { path: '', total: 0, error: String(error?.message ?? error) }
      }
    }, [url])

    if (built.error !== undefined) {
      return h('div', { className: 'wc-qr wc-qr--failed', role: 'img', 'aria-label': label }, '二维码生成失败')
    }
    return h(
      'svg',
      {
        className: 'wc-qr',
        width: size,
        height: size,
        viewBox: `0 0 ${built.total} ${built.total}`,
        shapeRendering: 'crispEdges',
        role: 'img',
        'aria-label': label,
      },
      h('rect', { width: built.total, height: built.total, fill: '#fff' }),
      h('path', { d: built.path, fill: '#000' }),
    )
  }
}
