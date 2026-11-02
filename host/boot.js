/* 启动画面的时序与交接。注入到 </body> 之前，早于应用模块执行。 */
(() => {
  var MIN_SHOW = 1700;   // 字标 1.47s 落定，再留 ~230ms 让完整画面停一拍
  var MAX_SHOW = 10000;  // 兜底：应用迟迟不 ready 也要收场
  var FADE = 280;

  var el = document.querySelector('[data-sk-boot]');
  if (el === null) return;

  var t0 = performance.now();
  var closing = false;
  var ready = false;

  function appMounted() {
    // 判据：应用外壳已经渲染出槽位。比"自带 loading 卡片消失"更可靠 ——
    // 那张卡片是在 mount 之后才被 dispose 的，时序上比外壳晚。
    return document.querySelector('[data-slot="sidebar"]') !== null
      || document.querySelector('[class*="_frame"]') !== null;
  }

  function bail() {
    // 超时仍未挂载：把自带 loading 卡片还回去，自己退出舞台
    document.documentElement.setAttribute('data-sk-boot-bailed', '');
    close();
  }

  function close() {
    if (closing) return;
    closing = true;
    marks.closedAt = performance.now() - t0;
    observer.disconnect();
    el.setAttribute('data-sk-leaving', '');
    removeEventListener('keydown', onKey);
    el.removeEventListener('pointerdown', close);
    setTimeout(() => el.remove(), FADE + 60);
  }

  function finish() {
    if (closing || ready) return;
    var elapsed = performance.now() - t0;
    if (elapsed < MIN_SHOW) {
      setTimeout(finish, MIN_SHOW - elapsed + 10);
      return;
    }
    if (!appMounted()) {
      // 时间到了但应用还没好：继续等，交给 MAX_SHOW 兜底
      setTimeout(finish, 120);
      return;
    }
    // 画面到点 + 应用已挂载：直接收场，不留"空等"的一拍。
    ready = true;
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') close();
  }

  // 调试/观测：记录"什么时候真正挂载"和"什么时候收场"，方便调 MIN/MAX
  var marks = (globalThis.__skBoot = { t0: t0, mountedAt: null, closedAt: null });

  var observer = new MutationObserver(() => {
    if (marks.mountedAt === null && appMounted()) marks.mountedAt = performance.now() - t0;
    if (!closing) finish();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  el.addEventListener('pointerdown', close);
  addEventListener('keydown', onKey);

  setTimeout(finish, MIN_SHOW);
  setTimeout(bail, MAX_SHOW);
})();
