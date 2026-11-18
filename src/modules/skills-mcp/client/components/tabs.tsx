/**
 * The MCP / Skills tab strip.
 *
 * Labels carry the entry counts (`MCP（5）`); switching tabs also clears the inline
 * editor and the expanded row — that reset lives in the caller's onSelect.
 *
 * The strip is a real `tablist`: the selected tab has to be visible to the
 * accessibility tree, and the active styling is derived from `aria-selected`
 * (with `data-active` kept for older stylesheets/tests). `aria-controls` is
 * deliberately absent — the two panels live in `panel.tsx`, which owns no
 * stable id to point at; the buttons carry ids so that panel can adopt
 * `aria-labelledby` without touching this file.
 */
import { tabLabel } from './filters.js'

/** Tab ids in render order, with their display titles. */
export const TAB_ITEMS = [
  { id: 'mcp', title: 'MCP' },
  { id: 'skills', title: 'Skills' },
]

/** DOM id of one tab button (stable, so a panel can label itself from it). */
export function tabButtonId(id) {
  return `smp-tab-${id}`
}

/** Build the tab strip. `counts` is `{ mcp, skills }`. */
export function tabStrip({ active, counts = {}, onSelect }) {
  return (
    <div className="smp-tabs" key="tabs" role="tablist">
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          id={tabButtonId(item.id)}
          className="smp-tab"
          role="tab"
          aria-selected={active === item.id}
          data-active={active === item.id}
          onClick={() => onSelect(item.id)}
        >
          {tabLabel(item.title, counts[item.id] ?? 0)}
        </button>
      ))}
    </div>
  )
}
