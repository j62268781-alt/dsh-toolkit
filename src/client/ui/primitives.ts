/**
 * The host's UI kit (`Button`, `Modal`, `MenuItemButton`, …), resolved exactly once.
 *
 * A plugin client is a CommonJS factory, so it cannot `import` a package that only
 * the shell has put in the module table: `require` is the synchronous lookup the
 * loader hands to that factory, and `import()` cannot see the table at all (it is
 * also rewritten away by the browser build). Every module used to spell this
 * `try/require` block out again, which is how `browser` and `judgment` ended up
 * with two copies of the same wrapper.
 *
 * A shell that publishes no primitives still has to load every module, so the
 * failure mode is an empty object: callers fall back to the native control
 * (`primitives.Button ?? "button"`), never to an error.
 */
export const primitives: any = (() => {
  try {
    return require("@deepseek-ai/dsh-client-ui-primitives");
  } catch {
    return {};
  }
})();
