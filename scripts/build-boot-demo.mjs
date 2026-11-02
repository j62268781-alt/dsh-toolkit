#!/usr/bin/env node
/**
 * 把真的开机画面（host/boot.css + host/boot.html）打包成一个可交互的演示页：
 * docs/boot/demo-boot.html。
 *
 * 为什么要生成而不是手写：手写的那版会跟实现漂移 —— 改完时序忘了同步演示页，
 * 下次调动画就靠一份过期的画面对参数。这里每次改完 host/boot.* 跑一遍即可。
 *
 * 用法：node scripts/build-boot-demo.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

const css = read("host/boot.css");
const html = read("host/boot.html").trim();
const script = read("host/boot.js");

/** boot.js 顶部那几个常量，演示页要用来对齐时间轴。 */
const pick = (name, fallback) => {
  const m = script.match(new RegExp(`var ${name}\\s*=\\s*(\\d+)`));
  return m === null ? fallback : Number(m[1]);
};
const MIN_SHOW = pick("MIN_SHOW", 1700);
const FADE = pick("FADE", 280);

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>启动画面 · dsh-shell-kit</title>
<!-- 由 scripts/build-boot-demo.mjs 生成，请勿手改；改 host/boot.* 后重新生成。 -->
<style>
  ${css.trim().replaceAll("\n", "\n  ")}
</style>
<style>
  /* 演示页自己的外壳，与画面无关 */
  body[data-ds-dark-theme] { --dsh-boot-bg: #151517; }
  html.demo { background: #e9eaec; }
  html.demo[data-ds-dark-theme] { background: #0b0b0d; }
  .demo-bar {
    position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
    z-index: 100001; display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-radius: 12px;
    background: rgba(255, 255, 255, .86); backdrop-filter: blur(14px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, .12);
    font: 12px/1.2 -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
    color: #0f1115;
  }
  html.demo[data-ds-dark-theme] .demo-bar { background: rgba(28, 28, 31, .86); color: #f9fafb; }
  .demo-bar input[type="range"] { width: 260px; }
  .demo-bar output { min-width: 62px; font-variant-numeric: tabular-nums; }
  .demo-bar button {
    font: inherit; padding: 5px 10px; border-radius: 7px; cursor: pointer;
    border: .5px solid rgba(127, 127, 127, .4); background: transparent; color: inherit;
  }
  .demo-bar button[aria-pressed="true"] { background: rgba(127, 127, 127, .18); }
  .demo-hint {
    position: fixed; left: 50%; top: 18px; transform: translateX(-50%);
    z-index: 100001; font: 12px/1.4 -apple-system, system-ui, sans-serif;
    color: #61666b; opacity: .8;
  }
  /* 演示里画面不淡出：停在最后一帧更利于比对 */
  .sk-boot { transition: none !important; }
</style>
</head>
<body class="demo">
${html}

<div class="demo-hint">滚轴可逐帧停看：描线 110–780ms · 填色 760–1160ms · 字标 950–1470ms · 退场 ${MIN_SHOW}ms + ${FADE}ms</div>
<div class="demo-bar">
  <button id="play" aria-pressed="true">暂停</button>
  <input id="seek" type="range" min="0" max="${MIN_SHOW + FADE}" step="10" value="${MIN_SHOW}">
  <output id="t"></output>
  <button id="theme">浅色 / 深色</button>
</div>
<script>
  document.documentElement.classList.add('demo');
  var MIN_SHOW = ${MIN_SHOW}, FADE = ${FADE};
  var boot = document.querySelector('.sk-boot');
  var seek = document.getElementById('seek');
  var out = document.getElementById('t');
  var playing = false, raf = 0, t = MIN_SHOW;

  // 演示页里没有真正的宿主，靠自己「假就绪」：直接改写进度条与淡出
  function animations() { return document.getAnimations(); }

  function apply(ms) {
    t = ms;
    seek.value = String(ms);
    out.textContent = ms + 'ms';
    // CSS 动画带着 delay，currentTime 从动画起点算，所以直接对齐即可
    for (const a of animations()) {
      a.pause();
      try { a.currentTime = ms; } catch (e) { /* 已结束的动画忽略 */ }
    }
    // 淡出：演示里手动模拟宿主在 MIN_SHOW 之后收场
    boot.toggleAttribute('data-sk-leaving', ms >= MIN_SHOW);
    boot.style.opacity = ms >= MIN_SHOW ? String(Math.max(0, 1 - (ms - MIN_SHOW) / FADE)) : '1';
  }

  function tick() {
    if (!playing) return;
    var next = t + 16;
    if (next > MIN_SHOW + FADE) next = 0;
    apply(next);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    playing = true;
    document.getElementById('play').setAttribute('aria-pressed', 'true');
    document.getElementById('play').textContent = '暂停';
    apply(t >= MIN_SHOW + FADE ? 0 : t);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    document.getElementById('play').setAttribute('aria-pressed', 'false');
    document.getElementById('play').textContent = '播放';
    cancelAnimationFrame(raf);
  }

  document.getElementById('play').onclick = function () { playing ? pause() : play(); };
  seek.oninput = function () { pause(); apply(Number(seek.value)); };
  document.getElementById('theme').onclick = function () {
    document.body.toggleAttribute('data-ds-dark-theme');
  };
  addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); } });

  // 让所有动画先实例化，再停在目标帧
  apply(MIN_SHOW);

  window.__boot = {
    at: function (ms) { pause(); apply(ms); },
    play: play,
    pause: pause,
    MIN_SHOW: MIN_SHOW,
    FADE: FADE
  };
</script>
</body>
</html>
`;

writeFileSync(new URL("docs/boot/demo-boot.html", root), page);
console.log(
  "docs/boot/demo-boot.html ← host/boot.css + host/boot.html" +
    ` (MIN_SHOW=${MIN_SHOW}, FADE=${FADE})`,
);