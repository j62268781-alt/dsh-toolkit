import { createElement, isValidElement, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

const FLOW_SLOT = "conversation.chat.flow";
const NODE_SLOT = "conversation.chat.node";
const MINIMUM_ROWS = 48;
const EDGE_ROWS = 8;
const OVERSCAN_SCREENS = 3;

type Entry = { kind: string; key: string; groupPart?: string };
type FlowProps = { entries: readonly Entry[] };
type NativeFlow = (props: FlowProps) => ReactNode;
type SlotEntry = {
  locale?: string;
  children?: Record<string, unknown>;
  component?: { $$typeof?: symbol; type?: NativeFlow } | NativeFlow;
};
type ClientContext = {
  effect(run: () => () => void, label: string): void;
  slots: {
    entriesOfSlot(key: string): readonly SlotEntry[];
    subscribe(key: string, callback: () => void): () => void;
  };
};
type FlowState = {
  enabled(): boolean;
  subscribe(callback: () => void): () => void;
};
type Spacer = {
  className: string;
  anchor?: string;
  node?: string;
  turn?: string;
  part?: string;
  kind?: string;
  group?: string;
  height: number;
  marginTop: string;
  marginBottom: string;
};

export const inject = ["slots"];

function rowKey(entry: Entry): string {
  return entry.kind === "group" || !entry.groupPart || entry.groupPart === "response"
    ? entry.key : JSON.stringify([entry.key, entry.groupPart]);
}

function elementKey(entry: Entry): string {
  return JSON.stringify(entry.kind === "group"
    ? ["group", entry.key] : ["node", entry.key, entry.groupPart ?? null]);
}

function makeFlow(useNativeRows: NativeFlow, state: FlowState): NativeFlow {
  return function WindowedChatFlow(props) {
    const nativeRows = useNativeRows(props);
    const enabled = useSyncExternalStore(state.subscribe, state.enabled);
    const marker = useRef<HTMLSpanElement>(null);
    const currentEntries = useRef(props.entries);
    const schedule = useRef<(() => void) | null>(null);
    const [spacers, setSpacers] = useState(new Map<string, Spacer>());
    const [search, setSearch] = useState(false);
    const active = enabled && !search && Array.isArray(nativeRows) && props.entries.length >= MINIMUM_ROWS;

    useLayoutEffect(() => {
      currentEntries.current = props.entries;
      schedule.current?.();
    }, [props.entries]);

    useLayoutEffect(() => {
      if (!active) return;
      const slot = marker.current?.parentElement;
      const column = slot?.closest("[data-chat-flow]");
      const viewport = slot?.closest("[data-conversation-scroll]");
      if (!column || !viewport || slot.dataset.slot !== FLOW_SLOT) return;
      let pending = 0;
      let width = column.getBoundingClientRect().width;
      let previous = new Map<string, Spacer>();

      const measure = () => {
        pending = 0;
        const bounds = viewport.getBoundingClientRect();
        const nextWidth = column.getBoundingClientRect().width;
        if (bounds.height <= 0 || nextWidth <= 0) return;
        if (Math.abs(width - nextWidth) > 1) {
          width = nextWidth;
          if (previous.size > 0) {
            previous = new Map();
            setSpacers(previous);
            request();
            return;
          }
        }
        const eligible = new Set(currentEntries.current.slice(EDGE_ROWS, -EDGE_ROWS).map(rowKey));
        const next = new Map<string, Spacer>();
        const extra = bounds.height * OVERSCAN_SCREENS;
        const selection = document.getSelection();
        const focus = document.activeElement;
        for (const row of slot.children) {
          if (!(row instanceof HTMLElement)) continue;
          const key = row.dataset.chatFlowKey;
          if (key === undefined || !eligible.has(key) || row.hidden || row.hasAttribute("data-chat-motion")) continue;
          const rect = row.getBoundingClientRect();
          if (rect.height <= 0 || (rect.bottom >= bounds.top - extra && rect.top <= bounds.bottom + extra)) continue;
          if (row.contains(focus) || (selection && !selection.isCollapsed && selection.containsNode(row, true))) continue;
          if (row.hasAttribute("data-dsh-chat-scroll-spacer")) {
            const saved = previous.get(key);
            if (saved) next.set(key, saved);
            continue;
          }
          if (row.querySelector("[data-chat-motion]")) continue;
          const style = getComputedStyle(row);
          next.set(key, {
            className: row.className,
            anchor: row.dataset.chatAnchorKey,
            node: row.dataset.chatNodeKey,
            turn: row.dataset.chatTurn,
            part: row.dataset.chatGroupPart,
            kind: row.dataset.chatFlowKind,
            group: row.dataset.chatGroupKey,
            height: rect.height,
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
          });
        }
        if (previous.size === next.size && [...next].every(([key, value]) => previous.get(key) === value)) return;
        previous = next;
        setSpacers(next);
      };
      const request = () => { if (!pending) pending = requestAnimationFrame(measure); };
      schedule.current = request;
      const observer = new ResizeObserver(request);
      observer.observe(viewport);
      observer.observe(column);
      viewport.addEventListener("scroll", request, { passive: true });
      request();
      return () => {
        schedule.current = null;
        cancelAnimationFrame(pending);
        observer.disconnect();
        viewport.removeEventListener("scroll", request);
      };
    }, [active]);

    useLayoutEffect(() => {
      if (!enabled) return;
      const find = (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
        setSearch(true);
      };
      window.addEventListener("keydown", find, true);
      return () => window.removeEventListener("keydown", find, true);
    }, [enabled]);

    if (!active || !Array.isArray(nativeRows)) return nativeRows;
    const keys = new Map(props.entries.slice(EDGE_ROWS, -EDGE_ROWS).map(entry => [elementKey(entry), rowKey(entry)]));
    const rows: ReactNode[] = nativeRows.map((row: ReactNode) => {
      if (!isValidElement(row) || row.key === null) return row;
      const key = keys.get(row.key);
      if (key === undefined) return row;
      const spacer = spacers.get(key);
      if (!spacer) return row;
      return createElement("div", {
        key: row.key,
        className: spacer.className,
        "aria-hidden": true,
        "data-dsh-chat-scroll-spacer": "",
        "data-chat-flow-key": key,
        "data-chat-anchor-key": spacer.anchor,
        "data-chat-node-key": spacer.node,
        "data-chat-turn": spacer.turn,
        "data-chat-group-part": spacer.part,
        "data-chat-flow-kind": spacer.kind,
        "data-chat-group-key": spacer.group,
        style: {
          boxSizing: "border-box", height: spacer.height, minHeight: spacer.height,
          flexShrink: 0, marginTop: spacer.marginTop, marginBottom: spacer.marginBottom,
          padding: 0, border: 0, pointerEvents: "none",
        },
      }, createElement("span", { hidden: true }));
    });
    rows.push(createElement("span", { hidden: true, key: "toolkit-chat-scroll-marker", ref: marker, "data-dsh-chat-scroll": "" }));
    return rows;
  };
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    let entry: SlotEntry | undefined;
    let original: SlotEntry["component"];
    let wrapper: NativeFlow | undefined;
    let enabled = false;
    const subscribers = new Set<() => void>();
    const state: FlowState = {
      enabled: () => enabled,
      subscribe(callback) {
        subscribers.add(callback);
        return () => { subscribers.delete(callback); };
      },
    };
    const restore = () => {
      if (entry && entry.component === wrapper) entry.component = original;
      entry = original = wrapper = undefined;
      enabled = false;
      for (const callback of subscribers) callback();
    };
    const install = () => {
      const candidate = ctx.slots.entriesOfSlot(FLOW_SLOT)[0];
      if (candidate === entry) return;
      restore();
      if (candidate?.locale !== "chat" || !candidate.children?.[NODE_SLOT]) return;
      const component = candidate.component;
      // Keep native ownership of the child slots. DSH rc.5 declares them on this entry.
      if (!component || typeof component === "function" || component.$$typeof !== Symbol.for("react.memo")
        || component.type?.name !== "ChatFlow") return;
      entry = candidate;
      original = component;
      wrapper = makeFlow(component.type, state);
      entry.component = wrapper;
      enabled = true;
    };
    install();
    const unsubscribe = ctx.slots.subscribe(FLOW_SLOT, install);
    return () => {
      unsubscribe();
      restore();
    };
  }, "dsh-toolkit-chat-scroll:flow");
}
