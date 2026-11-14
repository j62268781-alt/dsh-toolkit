/**
 * 构建期被读成字符串的资源：`build-client.mjs` 的 `.css` / `.html` text loader。
 * 没有这几个通配声明，`import css from './x.css'` 会报 TS2307。
 */
declare module '*.css' {
  const text: string
  export default text
}

declare module '*.html' {
  const text: string
  export default text
}

declare module '*.svg' {
  const text: string
  export default text
}
