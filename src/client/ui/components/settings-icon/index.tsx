/** Shared settings-nav glyphs registered through the public `settings.section.icon` slot.
 *
 * Each feature module owns its own icon: right next to the `settings.section`
 * registration it already makes, it calls `registerSettingsIcon` once. The shell
 * owns the nav button and label, and keeps its default gear for any section that
 * registers nothing. Every glyph is plain inline SVG drawn at 16x16 with
 * `currentColor` and no fill, so it follows the nav row's text color exactly like
 * the native icons do.
 */
import React from "react";

// JSX in this file compiles to `__dshReact.createElement`; every entry that ships
// JSX normally installs that global first, but the archived entry does not, so
// make sure it exists whichever module reaches this file first.
(globalThis as any).__dshReact ??= React;

export interface SettingsGlyphProps {
  size?: number;
  active?: boolean;
}

const SHAPES: Record<string, any> = {
  rocket: (
    <>
      <path d="M8 1.9c1.7 1.1 2.7 3 2.7 5 0 1.4-.4 2.6-1 3.7L8 12.1l-1.7-1.5a7 7 0 0 1-1-3.7c0-2 1-3.9 2.7-5Z" />
      <circle cx="8" cy="6" r="1.15" />
      <path d="M6.3 10.6 4.7 12.4M9.7 10.6l1.6 1.8M8 12.1v2.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <ellipse cx="8" cy="8" rx="2.7" ry="6" />
    </>
  ),
  scale: (
    <>
      <path d="M8 2.6v10.8M5.7 13.4h4.6M2.9 5.1h10.2" />
      <path d="M2.9 5.1 1.6 8.3h2.6L2.9 5.1ZM13.1 5.1l-1.3 3.2h2.6L13.1 5.1Z" />
    </>
  ),
  bell: (
    <>
      <path d="M8 2.1c-2.2 0-3.7 1.6-3.7 3.8 0 2.4-.7 3.4-1.3 4.1-.2.3 0 .7.3.7h9.4c.3 0 .5-.4.3-.7-.6-.7-1.3-1.7-1.3-4.1 0-2.2-1.5-3.8-3.7-3.8Z" />
      <path d="M6.6 11a1.4 1.4 0 0 0 2.8 0" />
      <path d="M8 2.1V1.2" />
    </>
  ),
  paw: (
    <>
      <ellipse cx="4.7" cy="5.7" rx="1.1" ry="1.45" />
      <ellipse cx="8" cy="4.5" rx="1.1" ry="1.45" />
      <ellipse cx="11.3" cy="5.7" rx="1.1" ry="1.45" />
      <path d="M8 7.9c2 0 3.4 1.4 3.4 3 0 1.3-1 2.2-2.2 2.2-.5 0-.8-.2-1.2-.2s-.7.2-1.2.2c-1.2 0-2.2-.9-2.2-2.2 0-1.6 1.4-3 3.4-3Z" />
    </>
  ),
  palette: (
    <>
      <path d="M8 2.3c-3.2 0-5.7 2.5-5.7 5.7s2.5 5.7 5.7 5.7c.9 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.4-1-.2-.3-.4-.5-.4-.9 0-.7.6-1.3 1.3-1.3h1.2c1.6 0 2.9-1.3 2.9-2.9 0-2.2-2.5-3.9-6.1-3.9Z" />
      <circle cx="5.6" cy="6.3" r=".75" />
      <circle cx="8.6" cy="4.9" r=".75" />
      <circle cx="11.1" cy="6.6" r=".75" />
    </>
  ),
  archive: (
    <>
      <rect x="1.9" y="2.6" width="12.2" height="2.5" rx=".7" />
      <path d="M2.6 5.1h10.8v7.4c0 .7-.6 1.3-1.3 1.3H3.9c-.7 0-1.3-.6-1.3-1.3V5.1Z" />
      <path d="M6.3 8.5h3.4" />
    </>
  ),
  plug: (
    <>
      <path d="M6 2.3v3.2M10 2.3v3.2" />
      <path d="M4.4 5.5h7.2v1.6a3.6 3.6 0 0 1-7.2 0V5.5Z" />
      <path d="M8 10.7v2.6" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="4.6" />
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1" />
    </>
  ),
};

/** One React component per icon key; the shell passes `{ size, active }`. */
function createGlyph(key: string) {
  function ToolkitSettingsGlyph({ size = 16, active = false }: SettingsGlyphProps) {
    const edge = typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 16;
    return (
      <svg
        viewBox="0 0 16 16"
        width={edge}
        height={edge}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        data-sk-settings-icon={key}
        data-active={active ? "true" : "false"}
      >
        {SHAPES[key]}
      </svg>
    );
  }
  (ToolkitSettingsGlyph as any).displayName = `ToolkitSettingsGlyph(${key})`;
  return ToolkitSettingsGlyph;
}

const GLYPH_COMPONENTS: Record<string, any> = Object.freeze(
  Object.fromEntries(Object.keys(SHAPES).map((key) => [key, createGlyph(key)])),
);

/**
 * Register one module-owned glyph on the public `settings.section.icon` slot.
 * `sectionId` must be the module's own `settings.section` id and `iconKey` one of
 * the shipped glyphs. Returns the unregister disposer, or undefined when the
 * slots API is missing/throws or the arguments are unknown.
 */
export function registerSettingsIcon(ctx: any, sectionId: string, iconKey: string): (() => void) | undefined {
  const slots = ctx?.slots;
  if (typeof slots?.inject !== "function" || typeof slots?.register !== "function") return undefined;
  if (typeof sectionId !== "string" || sectionId === "") return undefined;
  const Glyph = GLYPH_COMPONENTS[iconKey];
  if (!Glyph) return undefined;
  try {
    const dispose = slots.inject("settings.section.icon", () => slots.register({
      name: "settings.section.icon",
      id: sectionId,
    }, Glyph));
    return typeof dispose === "function" ? dispose : undefined;
  } catch {
    // A broken slot registry only means "no icon"; the module still loads.
    return undefined;
  }
}
