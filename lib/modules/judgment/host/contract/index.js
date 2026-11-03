/**
 * dsh-judgment · 能力契约（入口 `dsh-judgment/contract`）
 *
 * 「它判断，消费者决定。」本文件只描述**结构化判断**这一项能力：
 * 一次调用 = 一份状态 + 一批命名问题 → 一批概率答案。它不含循环、不含领域知识、
 * 不含任何默认值。
 *
 * # 三条模块纪律（§13.9，唯一不能省的部分）
 *
 * 1. **零 import**：本文件不得 import 任何模块——含 `node:*`、含 provider 内部文件。
 * 2. **零运行时值**：只导出 `type` / `interface`。没有 `const` / `enum` / `class` /
 *    `function`。消费者一律 `import type`，编译期擦除后**不引入任何运行时代码**。
 *    （因此 `JudgmentError` 在这里是「错误的形状」，运行期的类与类型守卫属于
 *    根入口 `"."`，见其 TSDoc。）
 * 3. **单向依赖**：`provider → contract`。contract 永不反向引用。
 *
 * 将来若要把 contract 提成独立包，只是把本目录搬出去并在原路径留一个 re-export
 * 垫片，消费者只改一个 import 路径（§13.9「拆分预案」）。
 *
 * # 消费者用法（无硬依赖，§13.3 第 2 层）
 *
 * ```ts
 * import type { ApiVersion, Judge } from 'dsh-judgment/contract'
 *
 * const EXPECTED: ApiVersion = 1          // 本地常量即版本契约，契约里没有运行时常量
 * const judge = ctx.get('judgment') as Judge | undefined   // 调用点惰性解析，缺失不抛错
 * if (!judge || judge.apiVersion !== EXPECTED) return useHostModelJudge()
 * ```
 *
 * `HostModelJudge`（消费者内置、零依赖）实现同一个 `Judge`，所以消费者的循环代码
 * 只有一份，只换 judge（§13.3 第 3 层）。
 */
export {};
//# sourceMappingURL=index.js.map