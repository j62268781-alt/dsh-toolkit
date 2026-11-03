/**
 * Token pricing and cost estimation for the usage module.
 *
 * Prices are currency units per 1,000,000 tokens and follow the root `usage.prices`
 * configuration. Token fields are fixed across the widget contract:
 * `inputTokens` (cache-miss input), `outputTokens`, `cacheReadTokens` (cache hit),
 * `cacheWriteTokens`.
 *
 * Default table source: DeepSeek official pricing (api-docs.deepseek.com, fetched
 * 2026-11-03), peak-hour list price. DeepSeek bills cache writes as cache-miss
 * input, so `cacheWrite` equals `input`. The built-in table deliberately includes
 * a `provider: "*" model: "*"` fallback so every known model is priced; a custom
 * configuration without a matching row leaves tokens counted as `unpricedTokens`.
 */

/** Fixed token field names used everywhere in this module. */
export const TOKEN_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
]);

/** Price fields, one per token field, in currency units per 1M tokens. */
export const PRICE_FIELDS = Object.freeze(["input", "output", "cacheRead", "cacheWrite"]);

/**
 * Default CNY table (per 1M tokens, peak hour): input 2, output 8,
 * cache read 0.04, cache write 2.
 */
export const DEFAULT_PRICES = Object.freeze([
  Object.freeze({ provider: "*", model: "deepseek-flash", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 }),
  Object.freeze({ provider: "*", model: "*", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 }),
]);

/** Default USD table, the official USD equivalents of {@link DEFAULT_PRICES}. */
export const DEFAULT_PRICES_USD = Object.freeze([
  Object.freeze({ provider: "*", model: "deepseek-flash", input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 }),
  Object.freeze({ provider: "*", model: "*", input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 }),
]);

/** @returns {{inputTokens:number, outputTokens:number, cacheReadTokens:number, cacheWriteTokens:number}} */
export function zeroTokens() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** Sum of the four contract token fields. */
export function totalTokens(tokens) {
  let total = 0;
  for (const field of TOKEN_FIELDS) total += count(tokens?.[field]);
  return total;
}

/** Add every token field of `source` into `target`; returns `target`. */
export function addTokens(target, source) {
  if (source === null || typeof source !== "object") return target;
  for (const field of TOKEN_FIELDS) target[field] += count(source[field]);
  return target;
}

/** Copy the four fields of a token record into a fresh object. */
export function copyTokens(tokens) {
  const copy = zeroTokens();
  return addTokens(copy, tokens);
}

/**
 * Project one usage-bearing session event into the contract's token shape.
 * @param {unknown} usage raw `data.usage` object.
 * @returns {{inputTokens:number, outputTokens:number, cacheReadTokens:number, cacheWriteTokens:number}}
 */
export function tokensFromUsage(usage) {
  return {
    inputTokens: count(usage?.inputTokens),
    outputTokens: count(usage?.outputTokens),
    cacheReadTokens: count(usage?.cacheReadTokens),
    cacheWriteTokens: count(usage?.cacheWriteTokens),
  };
}

/**
 * Validate and normalize a configured price table. Invalid rows are dropped.
 * @param {unknown} configured raw `usage.prices` value.
 * @returns {Array<{provider:string, model:string, input:number, output:number, cacheRead:number, cacheWrite:number}>}
 */
export function normalizePrices(configured) {
  if (!Array.isArray(configured)) return [];
  const prices = [];
  for (const raw of configured) {
    if (raw === null || typeof raw !== "object") continue;
    const provider = typeof raw.provider === "string" && raw.provider.trim() !== "" ? raw.provider : "*";
    const model = typeof raw.model === "string" && raw.model.trim() !== "" ? raw.model : "*";
    const price = { provider, model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const field of PRICE_FIELDS) price[field] = count(raw[field]);
    prices.push(price);
  }
  return prices;
}

/**
 * Resolve the effective price table: the configured one when non-empty, otherwise
 * the built-in default for the requested currency.
 * @param {unknown} configured raw `usage.prices` value.
 * @param {"CNY"|"USD"} [currency]
 * @returns {{prices:Array<{provider:string, model:string, input:number, output:number, cacheRead:number, cacheWrite:number}>, source:"config"|"default"}}
 */
export function effectivePrices(configured, currency = "CNY") {
  const prices = normalizePrices(configured);
  if (prices.length > 0) return { prices, source: "config" };
  const table = currency === "USD" ? DEFAULT_PRICES_USD : DEFAULT_PRICES;
  return { prices: table.map((price) => ({ ...price })), source: "default" };
}

/**
 * Match a provider/model pair against the price table.
 * Precedence: exact/exact, exact-provider/wildcard-model, wildcard-provider/exact-model,
 * wildcard/wildcard. Returns `null` when nothing matches.
 * @param {ReadonlyArray<{provider:string, model:string}>} prices
 * @param {string|null|undefined} provider
 * @param {string|null|undefined} model
 */
export function matchPrice(prices, provider, model) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const wantedProvider = typeof provider === "string" ? provider : "";
  const wantedModel = typeof model === "string" ? model : "";
  const tests = [
    (row) => row.provider === wantedProvider && row.model === wantedModel,
    (row) => row.provider === wantedProvider && row.model === "*",
    (row) => row.provider === "*" && row.model === wantedModel,
    (row) => row.provider === "*" && row.model === "*",
  ];
  for (const matches of tests) {
    const found = prices.find(matches);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * Cost of one token record at one price, in the table's currency units.
 * @param {{input:number, output:number, cacheRead:number, cacheWrite:number}} price
 * @param {{inputTokens?:number, outputTokens?:number, cacheReadTokens?:number, cacheWriteTokens?:number}} tokens
 * @returns {number}
 */
export function costOfTokens(price, tokens) {
  if (price === null || price === undefined) return 0;
  return (
    count(tokens?.inputTokens) * count(price.input) +
    count(tokens?.outputTokens) * count(price.output) +
    count(tokens?.cacheReadTokens) * count(price.cacheRead) +
    count(tokens?.cacheWriteTokens) * count(price.cacheWrite)
  ) / 1_000_000;
}

/**
 * Add up a cost across per-model token buckets.
 * @param {Iterable<{provider:string|null, model:string|null, tokens:object}>} buckets
 * @param {ReadonlyArray<{provider:string, model:string}>} prices
 * @returns {{amount:number, unpricedTokens:number}}
 */
export function costForModelBuckets(buckets, prices) {
  let amount = 0;
  let unpricedTokens = 0;
  for (const bucket of buckets ?? []) {
    const price = matchPrice(prices, bucket?.provider, bucket?.model);
    if (price === null) {
      unpricedTokens += totalTokens(bucket?.tokens);
      continue;
    }
    amount += costOfTokens(price, bucket.tokens);
  }
  return { amount, unpricedTokens };
}

/** Round a currency amount to the contract's 6-decimal display precision. */
export function round6(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 1_000_000) / 1_000_000;
}

/** Non-negative finite integer/number, or 0. */
function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
