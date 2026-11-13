/**
 * Register a module dictionary and drop it on unload.
 *
 * `locale.register` is scoped to the effect that calls it: registering outside an
 * effect leaves the strings behind after the module is gone, which is why only one
 * module ever did it. The dictionary itself stays next to the page that renders it
 * (`<module>/client/locale.js`); `locale/zh.json` is the shell's own copy and is
 * not a second source of the same strings.
 */
export function installDictionary(ctx: any, namespace: string, copy: Record<string, any>): unknown {
  return ctx.effect(() => ctx.locale.register(namespace, copy), `locale ${namespace}`);
}
