import { installMutableStylesheet } from "../../../../client/ui/stylesheet.js";

/** The host already validated these ids; this keeps a stray value out of a selector. */
const SELECTOR_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * One rule per deleted id, keyed on the attribute the sidebar already puts on a row.
 *
 * A session deleted while the host still held it cannot be retired any other way.
 * The host keeps it in memory with no eviction API, so the core keeps listing it,
 * and the archive registration is the tombstone that suppresses it — but only under
 * the default archived filter: with archived rows shown the same tombstone renders
 * as a grayed, unopenable row that stays behind after a delete.
 */
export function hiddenRowsCss(ids) {
  const rules = [];
  for (const id of ids) {
    if (typeof id !== "string" || !SELECTOR_SAFE.test(id)) continue;
    rules.push(`[data-row-key="session:${id}"]{display:none !important}`);
  }
  return rules.join("\n");
}

/**
 * Keep every deleted session row out of the sidebar until the host drops it.
 *
 * The ids come from `removal.snapshot().hidden`, which merges the two halves of a
 * tombstone's life: the ids this page deleted (so the row leaves on the same commit
 * that closes the confirmation dialog) and the host's pending markers (the same ids
 * after a reload, while the Session is still held in memory). A marker lives until
 * the next restart, which is also when the host retires the registration.
 *
 * No read of its own: the removal controller reads the markers once at startup and
 * once per batch, and every change to `hidden` notifies this renderer.
 */
export function installHiddenRows(removal) {
  const sheet = installMutableStylesheet("toolkit-archived-hidden");
  let written;

  const render = () => {
    const css = hiddenRowsCss(removal.snapshot().hidden);
    if (css === written) return;
    written = css;
    sheet.set(css);
  };

  const unsubscribe = removal.subscribe(render);
  render();
  return () => {
    unsubscribe();
    sheet.dispose();
  };
}
