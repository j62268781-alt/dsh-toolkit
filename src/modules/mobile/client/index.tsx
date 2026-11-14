import { fetchJson } from "../../../client/http.js";
import { API_PREFIX as PREFIX } from "../host/constants.js";
import { createCanvasRuntime } from "./stream/canvas.js";
import { createUseH264Canvas } from "./stream/use-h264-canvas.js";
import { REGRANT_UPSCALE_RATIO, REGRANT_DOWNSCALE_RATIO, REGRANT_UPSCALE_HOLD_MS, REGRANT_DOWNSCALE_HOLD_MS, REGRANT_MIN_INTERVAL_MS, REGRANT_COOLDOWN_MAX_MS, REGRANT_TICK_MS, REGRANT_STABLE_PX, DEVICE_WIDTH_FALLBACK, newRegrantStreak, nextCooldownMs, nextCooldownAfterGrant, decideRegrant, shouldAttemptRegrant, widthIsUnsettled, tickRegrant, neededPixelWidth } from "./stream/adaptive.js";
import { hintText, stageOverlay } from "./presentation.js";
import { createIcons } from "./components/icons.jsx";
import { createDeviceOptions } from "./components/device-options.jsx";
import { createStreamView } from "./components/stream-view.jsx";
import { createMobilePanel } from "./panel.jsx";
// 宿主注入依赖；带状态的运行时必须在每次工厂调用内创建。
export default function createClient(require) {
  const React = require("react");
  globalThis.__dshReact = React;
  const h = React.createElement;
  const Fragment = React.Fragment;
  const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  const TAB_ID = "@j62268781-alt/dsh-sidebar-mobile";
  const ROUTE_PANEL_OPEN = "panel-open";
  const ROUTE_PANEL_OPEN_ACK = "panel-open-ack";
  const SHORTCUT_ID = "sidebar.mobile";
  async function api(route, body, { signal } = {}) {
    let response;
    try {
      response = await fetchJson(`${PREFIX}/${route}`, {
        method: "POST", json: body ?? {}, signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`连不上插件路由（${route}）：${error?.message ?? error}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`路由 ${route} 返回了非 JSON：${error?.bodyPreview ?? error?.message ?? error}`);
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error ?? `路由 ${route} 失败（HTTP ${response.status}）`);
    }
    return payload;
  }
  const CSS = __CLIENT_CSS__;
  const canvasRuntime = createCanvasRuntime();
  const { maxMediaCssWidth } = canvasRuntime;
  const icons = createIcons(React);
  const { MobileArtwork } = icons;
  const renderDeviceOptions = createDeviceOptions(React);
  const useH264Canvas = createUseH264Canvas(React, canvasRuntime);
  const StreamView = createStreamView(React, { api, prefix: PREFIX, useH264Canvas });
  const MobilePanel = createMobilePanel(React, { primitives, api, CSS, canvasRuntime, StreamView, icons, renderDeviceOptions });
  function MobileTitle({ useTabInfo }) {
    const { tab } = useTabInfo();
    return <>
      <MobileArtwork
        size={16}
        className="mbm-title-icon"
        color="currentColor"
        dense
      />
      {tab.title}
    </>;
  }
  return {
    // sidebarRight / shortcuts 可选注入，面板的基础 slot 和类型注册必需。
    inject: ["slots", "sidebarRightTabs"],
    // 纯逻辑与调参接口，保留给流回归测试。
    __test: {
      decideRegrant,
      shouldAttemptRegrant,
      tickRegrant,
      widthIsUnsettled,
      newRegrantStreak,
      neededPixelWidth,
      maxMediaCssWidth,
      stageOverlay,
      hintText,
      setDevicePixelWidth(width) {
        canvasRuntime.setDevicePixelWidth(width);
      },
      nextCooldownMs,
      nextCooldownAfterGrant,
      tuning: {
        upscaleRatio: REGRANT_UPSCALE_RATIO,
        downscaleRatio: REGRANT_DOWNSCALE_RATIO,
        upscaleHoldMs: REGRANT_UPSCALE_HOLD_MS,
        downscaleHoldMs: REGRANT_DOWNSCALE_HOLD_MS,
        minIntervalMs: REGRANT_MIN_INTERVAL_MS,
        cooldownMaxMs: REGRANT_COOLDOWN_MAX_MS,
        tickMs: REGRANT_TICK_MS,
        stablePx: REGRANT_STABLE_PX,
        deviceWidthFallback: DEVICE_WIDTH_FALLBACK
      }
    },
    apply(ctx) {
      // 模型打开面板的长轮询必须在插件加载期启动，不能等面板挂载。
      ctx.inject(["sidebarRight"], (scope) => {
        scope.effect(() => {
          let stopped = false;
          const controller = new AbortController();
          let lastHandled = 0;
          const RETRY_DELAY_MS = 2e3;
          const STUCK_DELAY_MS = 1e3;
          const sleep = (ms) => new Promise((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, ms);
            controller.signal.addEventListener("abort", done, { once: true });
            if (controller.signal.aborted) done();
          });
          const pump = async () => {
            while (!stopped) {
              let seq = null;
              let healthy = false;
              try {
                const response = await fetch(`${PREFIX}/${ROUTE_PANEL_OPEN}`, { method: "GET", signal: controller.signal });
                if (stopped) return;
                if (response.ok) {
                  const payload = await response.json().catch(() => null);
                  if (payload !== null) {
                    healthy = true;
                    seq = typeof payload.request === "number" ? payload.request : null;
                  }
                }
              } catch {
              }
              if (stopped) return;
              if (!healthy) {
                await sleep(RETRY_DELAY_MS);
                continue;
              }
              if (seq === null) continue;
              if (seq === lastHandled) {
                try {
                  await api(ROUTE_PANEL_OPEN_ACK, { request: seq }, { signal: controller.signal });
                } catch {
                }
                await sleep(STUCK_DELAY_MS);
                continue;
              }
              lastHandled = seq;
              try {
                scope.sidebarRight.openTab("mobile");
              } catch {
              }
              try {
                await api(ROUTE_PANEL_OPEN_ACK, { request: seq }, { signal: controller.signal });
              } catch {
              }
            }
          };
          void pump();
          return () => {
            stopped = true;
            controller.abort();
          };
        }, "dsh-toolkit-mobile:panel-open-poll");
      });
      ctx.inject(["shortcuts", "sidebarRight"], (scope) => {
        scope.effect(
          () => scope.shortcuts.register({
            id: SHORTCUT_ID,
            label: () => "移动设备",
            aliases: ["mobile", "device", "android", "ios", "手机", "移动设备"],
            defaults: {
              // macOS 的原生最小化命令占用 ⌘M，因此桌面端使用 Shift。
              "desktop:macos": { code: "KeyM", modifiers: ["primary", "shift"] },
              "desktop:windows": { code: "KeyM", modifiers: ["primary", "shift"] },
              "desktop:linux": { code: "KeyM", modifiers: ["primary", "shift"] },
              // Web 使用 Alt，避开浏览器占用的 primary+shift 组合。
              "web:macos": { code: "KeyM", modifiers: ["primary", "alt"] },
              "web:windows": { code: "KeyM", modifiers: ["primary", "alt"] }
            },
            regions: ["page", "editable", "terminal"],
            modals: [],
            resolve: ({ target: element }) => {
              const target = scope.sidebarRight.commandTarget(element);
              if (target === void 0) {
                return { status: "blocked", reason: "先打开一个会话，再打开移动设备" };
              }
              return {
                status: "handled",
                run: () => {
                  scope.sidebarRight.openTabFromTarget("mobile", target);
                }
              };
            }
          }),
          "dsh-toolkit-mobile:shortcut"
        );
      });
      ctx.effect(
        () => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: "mobile",
          // 页类型不给 patterns：它不认领资源地址，只能被显式打开
          multiple: false,
          title: () => "移动设备",
          // 切换会话保留流与解码器；卸载会重新等待关键帧。
          keepMounted: true,
          // 无资源地址的页类型通过「开始」页 guide 打开。
          guide: [
            {
              id: "mobile",
              order: 40,
              // 与快捷键注册 ID 一致，让入口显示快捷键徽标。
              commandId: SHORTCUT_ID,
              title: () => "移动设备",
              description: () => "实时画面 + 直接操作 iOS / Android 设备",
              icon: MobileArtwork
            }
          ]
        }),
        "dsh-toolkit-mobile:tab-type"
      );
      ctx.effect(
        () => ctx.slots.register(
          {
            name: "sidebar.right.pane.tab",
            key: TAB_ID
          },
          MobilePanel
        ),
        "dsh-toolkit-mobile:tab-body"
      );
      ctx.effect(
        () => ctx.slots.register(
          {
            name: "sidebar.right.pane.tab.title",
            key: TAB_ID
          },
          MobileTitle
        ),
        "dsh-toolkit-mobile:tab-title"
      );
    }
  };
}
