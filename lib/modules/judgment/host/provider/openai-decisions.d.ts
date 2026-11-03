/**
 * **OpenAI-Decisions**（协议里的 `predicate`）线格式：编码 + 严格解码。
 *
 * 这是**第二套协议**，用来验证"一套归一化 schema 够不够用"（§13.7 P0′ 的核心问题）。
 * 线格式抄自调研目录里那份可运行实现（`/tmp/jev-survey/dsh-jev-plugin` 的
 * `wire.ts: protocolBody` / `parseProtocolResponse`，对应它的 `luna-openai` 连接），
 * 与 SystemOne 的差异是**结构性的四处**：
 *
 * | | SystemOne (`noul`) | OpenAI-Decisions (`predicate`) |
 * |---|---|---|
 * | 状态字段 | `state`（任意 JSON） | `input`（**字符串**，非字符串要 `JSON.stringify`） |
 * | 问题容器 | `questions` 是**对象**（id 作键） | `questions` 是**数组**（`name` 字段） |
 * | 答案容器 | `answers` 是**对象** | `answers` 是**数组**，靠 `name` 反查 |
 * | 分布表示 | `probabilities: { id: p }` | `probabilities: [{ value, probability, label }]` |
 *
 * **证据等级**（2026-10-20 补）：
 * - 官方文档站 `developers.openai.com/api/docs/guides/decisions` 对脚本抓取返回 403，
 *   所以**没有**直接读到官方原文；
 * - 但有两份可核对的独立公开来源：
 *   ① promptfoo 的 `openai:decisions` provider 文档（2026-10-19 更新，逐条列出了
 *   请求/答案形状与约束）—— https://www.promptfoo.dev/docs/providers/openai-decisions/
 *   ② 一个**同时调用两家真实 API** 的对比项目（含价格、模型名、端点）
 *   —— https://github.com/Neha/jev-vs-openai-decisions
 * 据此已确认：端点 `POST /v1/decisions`、模型 `gpt-6-luna`、只按输入计费（$0.10/1M，输出免费）、
 * `predicate` 答案只有 `probability`（无 confidence）、`choice` / `score` 答案带
 * `probabilities` **数组** + `confidence`、`score` 是**0 基级别的概率加权均值**
 * （可落在两级之间——与 SystemOne 的期望值语义**相同**，早先"疑似下标"的猜测是错的）、
 * 拒答是 `{ name, type: 'refusal' }` 且不影响同批其它问题、`answers` **保持问题顺序**、
 * 省略 `name` 时该字段为 `null`。
 *
 * ⚠️ **仍未对着真实端点实测**（手上没有这条连接与密钥）。剩下三处只能等真机确认，
 * 代码对它们都取"宽容读取、语义照严"的策略（见文件末尾"待验证点"）。
 */
import type { JudgmentQuestions, JudgmentState } from '../contract/index.js';
import { type DecodedResponse } from './wire.js';
export type { DecodedResponse };
/** 一批问题 → OpenAI-Decisions 请求体。 */
export declare function encodeBody(model: string, state: JudgmentState, questions: JudgmentQuestions): Record<string, unknown>;
/** 严格解码一整批答案：任何结构问题都整批拒绝。 */
export declare function decodeResponse(raw: unknown, questions: JudgmentQuestions, expectedModel: string): DecodedResponse;
/**
 * 待验证点（有一条真实 `openai-decisions` 连接后逐条核对并回填实测结果）。
 *
 * 已经**不用**再验的（本轮据公开文档定稿）：
 * - `score` 语义 = 0 基级别的概率加权均值，可落在两级之间（与 SystemOne 相同）；
 * - 拒答形状 = `{ name, type: 'refusal' }`，且不影响同批其它问题；
 * - `predicate` 答案无 confidence；`choice` / `score` 答案有 `probabilities` + `confidence`；
 * - `answers` 保持问题顺序；省略 name 时该字段为 `null`。
 *
 * 仍然只有真机能定的三处（代码现在对它们都取宽容读取）：
 * 1. 分布项的键字段到底是 `value` 还是 `index`（两者都接）；
 * 2. 非拒答答案是否也带 `type`（有就校验一致性，没有就按问题原语解读）；
 * 3. 响应是否回显 `model`（回显则严格校验快照，不回显则退回配置里的模型名）。
 *
 * 另一处**刻意不跟**的地方：promptfoo 用自己的 ±1pp 容差做客户端校验，
 * 我们按契约统一用 0.02（`bridge.mjs:95` 的源码级数值）。容差属于契约，不随第三方实现漂移。
 */
//# sourceMappingURL=openai-decisions.d.ts.map