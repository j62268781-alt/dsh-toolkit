import React from "react";
import { TASK_MONITOR_NS } from "../../locale.js";
import { createTaskMonitorPanel } from "../../components/panel/index.jsx";
import { RAIL_HIDE_WIDTH, setRailNarrow, useRailChoice, useRailNarrow } from "../../state/rail.js";
import railCss from "./style.css";

export const NAME = "conversation-rail";

/**
 * 把任务监控挂进会话内容区，而不是宿主右栏。
 *
 * `conversation.hero.frame` 是宿主给「包住整块滚动区」的 HOC 座位：这里把默认的
 * 单列 children 改成「消息列 + 右栏」的 flex row，面板因此长在会话内部、和
 * composer 同一列高度里，像 Qoder 那样贴着对话。宿主自己的右栏（rightbar）保持不动。
 */
export function install(ctx: any) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);
  const Panel = createTaskMonitorPanel(ctx);
  // `sidebarRight` 没写进静态 inject，属性访问会被 cordis 的 inject 守卫拦成异常
  // （`cannot get property "sidebarRight" without inject`），`ctx.get()` 才是免守卫的
  // 取法。服务缺席时整份 actions 缺席，条目行随之降级成只读而不是点了没反应。
  const sidebarRight = sidebarRightOf(ctx);
  const actions = sidebarRight === undefined ? undefined : {
    openTab: (kind: string, options?: any) => sidebarRight.openTab?.(kind, options),
    openResource: (address: string, options?: any) => sidebarRight.openResource?.(address, options),
  };

  return ctx.slots.inject("conversation.hero.frame", () =>
    ctx.slots.register(
      { name: "conversation.hero.frame", id: "task-monitor-rail", order: 40 },
      (props: any) => <RailLayer {...props} Panel={Panel} actions={actions} label={t("trigger")} />,
    ),
  );
}

function sidebarRightOf(ctx: any): any {
  if (typeof ctx.get === "function") {
    const service = ctx.get("sidebarRight");
    if (service !== undefined) return service;
  }
  try {
    return ctx.sidebarRight;
  } catch {
    return undefined;
  }
}

function activeSessionId(useSessions: any): string | undefined {
  if (typeof useSessions !== "function") return undefined;
  return useSessions((state: any) => {
    const rows = Object.values(state?.byId ?? {}) as any[];
    return rows.find((row) => (row?.retainedBy?.mainView ?? 0) > 0)?.id;
  });
}

interface RailProps {
  children?: React.ReactNode;
  useSessions?: any;
  Panel: React.ComponentType<any>;
  actions: any;
  label: string;
}

function RailLayer({ children, useSessions, Panel, actions, label }: RailProps) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [embedded, setEmbedded] = React.useState(false);
  const [maxHeight, setMaxHeight] = React.useState<number | null>(null);
  const sessionId = activeSessionId(useSessions);
  const choice = useRailChoice(sessionId);
  const narrow = useRailNarrow();
  // 用户表过态就听用户的；没表态时，对话列太窄就默认收起。
  const open = !embedded && typeof sessionId === "string" && sessionId !== ""
    && (choice === "visible" || (choice === null && !narrow));

  // 子代理侧栏里也渲染一份 Conversation：那里已经有宿主自己的栏位，再塞一条
  // 监控会把同一会话的内容显示两遍。座位本身是 display:contents 的 data-slot，
  // 挂载后向上找它最省事。
  React.useEffect(() => {
    const wrap = wrapRef.current;
    setEmbedded(wrap !== null && wrap.closest('[data-slot="sidebar.chat.conversation"]') !== null);
  }, []);

  // 容器宽度而不是窗口宽度：左侧栏收起/展开时窗口没变，但对话区变宽了，
  // 用 window.matchMedia 会误判。阈值与 style.css 的 @container 保持一致。
  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null || typeof ResizeObserver === "undefined") return undefined;
    // 子代理侧栏里那份是窄槽，量它会误伤主会话：embedded 的实例不参与判定。
    if (wrap.closest('[data-slot="sidebar.chat.conversation"]') !== null) return undefined;

    // 卡片的可用高度必须按「会话内容区的下沿」量，不能只靠 CSS 的 100%：hero.frame
    // 的百分比基准在宿主里不一定等于可视区域，实测会出现卡片底部伸出窗口被裁掉。
    // 46 = 上边距 16 + 底部统计带占位 30。
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const scroll = wrap.querySelector("[data-conversation-scroll]");
      const bottom = scroll ? scroll.getBoundingClientRect().bottom : window.innerHeight;
      setMaxHeight(Math.max(180, Math.round(bottom - rect.top - 46)));
    };
    if (typeof window !== "undefined") window.addEventListener("resize", measure);

    const observer = new ResizeObserver(() => {
      setRailNarrow(wrap.getBoundingClientRect().width <= RAIL_HIDE_WIDTH);
      measure();
    });
    measure();
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (typeof window !== "undefined") window.removeEventListener("resize", measure);
      setRailNarrow(false);
    };
  }, []);

  return (
    <div ref={wrapRef} className="sk-task-monitor-frame" data-rail={open ? "open" : "closed"}>
      <style>{railCss}</style>
      <div className="sk-task-monitor-column">{children}</div>
      {open ? (
        <aside
          className="sk-task-monitor-side"
          aria-label={label}
          style={maxHeight === null ? undefined : { maxHeight }}
        >
          <Panel
            key={sessionId}
            sessionId={sessionId}
            useSessions={useSessions}
            actions={actions}
          />
        </aside>
      ) : null}
    </div>
  );
}
