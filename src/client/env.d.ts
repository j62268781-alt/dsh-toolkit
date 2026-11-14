/// <reference types="node" />

/**
 * client 侧的运行期全局。
 *
 * 这些名字由宿主/构建期注入，源码里没有对应的 import；不声明出来 tsc 会把它们当未定义名字。
 */
declare global {
  /** mobile 面板的样式文本由 `scripts/build-client.mjs` 在构建期内联。 */
  const __CLIENT_CSS__: string
}

export {}
