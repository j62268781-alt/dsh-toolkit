import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PRICES,
  DEFAULT_PRICES_USD,
  addTokens,
  copyTokens,
  costForModelBuckets,
  costOfTokens,
  effectivePrices,
  matchPrice,
  normalizePrices,
  round6,
  tokensFromUsage,
  totalTokens,
  zeroTokens,
} from "../../src/modules/usage/host/pricing.js";

test("default table uses the official DeepSeek peak prices and a wildcard fallback", () => {
  const deepseek = DEFAULT_PRICES.find((price) => price.model === "deepseek-flash");
  assert.deepEqual({ ...deepseek }, { provider: "*", model: "deepseek-flash", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 });
  assert.ok(DEFAULT_PRICES.some((price) => price.provider === "*" && price.model === "*"));
  const usd = DEFAULT_PRICES_USD.find((price) => price.model === "deepseek-flash");
  assert.deepEqual({ ...usd }, { provider: "*", model: "deepseek-flash", input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 });
});

test("effectivePrices prefers a valid configured table and otherwise uses the default for the currency", () => {
  const configured = effectivePrices([{ provider: "turing", model: "deepseek-flash", input: 1, output: 2 }], "CNY");
  assert.equal(configured.source, "config");
  assert.deepEqual(configured.prices, [
    { provider: "turing", model: "deepseek-flash", input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  ]);

  const fallback = effectivePrices([], "CNY");
  assert.equal(fallback.source, "default");
  assert.equal(fallback.prices[0].model, "deepseek-flash");

  const usd = effectivePrices(undefined, "USD");
  assert.equal(usd.source, "default");
  assert.equal(usd.prices[0].output, 1.2);

  assert.deepEqual(normalizePrices("not-an-array"), []);
  assert.deepEqual(
    normalizePrices([{ model: "", input: -5, output: "3" }, null, { provider: "p", model: "m", cacheRead: 0.5 }]),
    [
      { provider: "*", model: "*", input: 0, output: 3, cacheRead: 0, cacheWrite: 0 },
      { provider: "p", model: "m", input: 0, output: 0, cacheRead: 0.5, cacheWrite: 0 },
    ],
  );
});

test("matchPrice walks from exact to wildcard precedence", () => {
  const prices = normalizePrices([
    { provider: "*", model: "*", input: 9 },
    { provider: "*", model: "deepseek-flash", input: 2 },
    { provider: "turing", model: "*", input: 3 },
    { provider: "turing", model: "deepseek-flash", input: 4 },
  ]);
  assert.equal(matchPrice(prices, "turing", "deepseek-flash").input, 4);
  assert.equal(matchPrice(prices, "solar", "deepseek-flash").input, 2);
  assert.equal(matchPrice(prices, "turing", "other").input, 3);
  assert.equal(matchPrice(prices, "solar", "other").input, 9);
  assert.equal(matchPrice([], "turing", "deepseek-flash"), null);
  // A table without a wildcard row leaves unknown models unpriced.
  const exact = normalizePrices([{ provider: "turing", model: "deepseek-flash", input: 1 }]);
  assert.equal(matchPrice(exact, "solar", "qwen"), null);
});

test("costOfTokens and costForModelBuckets apply per-1M-token prices", () => {
  const price = { provider: "*", model: "deepseek-flash", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 };
  const tokens = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 250_000 };
  assert.equal(costOfTokens(price, tokens), 2 + 4 + 0.08 + 0.5);
  assert.equal(round6(costOfTokens(price, tokens)), 6.58);

  const buckets = [
    { provider: "turing", model: "deepseek-flash", tokens },
    { provider: "unknown", model: "mystery", tokens: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  ];
  const noWildcard = normalizePrices([{ provider: "turing", model: "deepseek-flash", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 }]);
  const priced = costForModelBuckets(buckets, noWildcard);
  assert.equal(round6(priced.amount), 6.58);
  assert.equal(priced.unpricedTokens, 10);

  const withWildcard = normalizePrices([{ provider: "*", model: "*", input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }]);
  const allPriced = costForModelBuckets(buckets, withWildcard);
  assert.equal(allPriced.unpricedTokens, 0);
  assert.equal(round6(allPriced.amount), (3_750_000 + 10) / 1_000_000);
});

test("token helpers keep the four contract fields", () => {
  assert.deepEqual(zeroTokens(), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const tokens = zeroTokens();
  addTokens(tokens, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 99 });
  addTokens(tokens, { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 });
  assert.deepEqual(tokens, { inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWriteTokens: 44 });
  assert.equal(totalTokens(tokens), 110);
  assert.deepEqual(copyTokens(tokens), tokens);
  assert.notEqual(copyTokens(tokens), tokens);
  assert.deepEqual(tokensFromUsage({ inputTokens: 5, outputTokens: 6, cacheReadTokens: 7 }), {
    inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 0,
  });
  assert.deepEqual(tokensFromUsage(null), zeroTokens());
  assert.equal(round6(0.0000004), 0);
  assert.equal(round6(0.0000006), 0.000001);
});
