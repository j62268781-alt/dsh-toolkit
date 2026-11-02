function apply(ctx) {
  // 先打平台标记：CSS 全表的门禁 `html[data-sk-desktop]` 依赖它，越早越不容易
  // 出现「样式已注入、门禁还没生效」的一帧。
  ctx.effect(installDesktopMarker, "dsh-shell-kit:desktop-marker");

  ctx.effect(() => {
    const sheet = installStylesheet();
    return sheet.dispose;
  }, "dsh-shell-kit:stylesheet");

  ctx.effect(installRailTitles, "dsh-shell-kit:rail-titles");
  ctx.effect(() => installHomeRail(ctx), "dsh-shell-kit:home-rail");
  ctx.effect(installBandHeight, "dsh-shell-kit:band-height");
  ctx.effect(() => installSidebarWidth(ctx), "dsh-shell-kit:sidebar-width");
  ctx.effect(() => installWorkspaceCollapse(ctx), "dsh-shell-kit:workspace-collapse");

  ctx.effect(() => ctx.locale.register(ARCH_NS, ARCH_COPY), "dsh-shell-kit:archived-dict");
  ctx.effect(() => installArchivedSection(ctx), "dsh-shell-kit:archived-section");

}

window.__ModuleLoader__.load({
  id: PKG,
  factory: (require) => {
    React = require("react");
    const exports = {};
    exports.apply = apply;
    exports.inject = ["slots", "layout", "locale", "sessions", "workspaces"];
    return exports;
  },
});
