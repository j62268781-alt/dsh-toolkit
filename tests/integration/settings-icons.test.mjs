/** Module-owned settings-nav icons.
 *
 * Every feature module registers its own `settings.section.icon` entry next to
 * the `settings.section` page it already owns, using the shared glyph helper in
 * `src/client/ui/components/settings-icon/index.tsx`. This test loads each real module client entry
 * (bundled with esbuild, exactly like the shipped client build), applies it with
 * a recording slots registry, and checks the registration, the rendered SVG and
 * the teardown. The shell keeps its default gear for any section that registers
 * nothing, so a missing slot registry must never take the module down.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import esbuild from "esbuild";

/** Set the JSX factory global before any bundle evaluates JSX. */
globalThis.__dshReact = React;

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CACHE = join(ROOT, "node_modules", ".cache", "settings-icons-test");
const ENTRY = join(ROOT, "src", "client", "ui", "components", "settings-icon", "index.tsx");

/** One row per module that owns a settings page. */
const MODULES = [
  { name: "boot", entry: "src/modules/boot/client/index.tsx", section: "boot", icon: "rocket" },
  { name: "browser", entry: "src/modules/browser/client/index.tsx", section: "browser", icon: "globe" },
  { name: "judgment", entry: "src/modules/judgment/client/index.tsx", section: "judgment", icon: "scale" },
  { name: "notification", entry: "src/modules/notification/client/index.tsx", section: "notification", icon: "bell", factory: true },
  { name: "pet", entry: "src/modules/pet/client/index.tsx", section: "desktop-pet", icon: "paw", factory: true },
  { name: "theme", entry: "src/modules/theme/client/index.ts", section: "theme", icon: "palette" },
  { name: "archived", entry: "src/modules/archived/client/index.ts", section: "archived-chats", icon: "archive" },
  { name: "skills-mcp", entry: "src/modules/skills-mcp/client/client.ts", section: "skills-mcp", icon: "plug", factory: true },
];

/** A slots registry that records only the icon registrations we care about. */
function recordingSlots() {
  const records = [];
  const disposed = [];
  return {
    records,
    disposed,
    inject(name, factory) {
      if (name !== "settings.section.icon") return () => {};
      return factory();
    },
    register(meta, Component) {
      if (meta?.name !== "settings.section.icon") return () => {};
      const record = { id: meta.id, Component };
      records.push(record);
      return () => {
        const index = records.indexOf(record);
        if (index !== -1) records.splice(index, 1);
        disposed.push(record.id);
      };
    },
  };
}

/** Fake ctx whose effects run only for the icon registration label. */
function createCtx(slots) {
  const iconDisposers = [];
  const ctx = {
    slots,
    configForms: { get: () => undefined },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      get: () => undefined,
      subscribe: () => () => {},
    },
    remote: { $mount: async () => {}, credentials: undefined },
    get: () => undefined,
    on: () => () => {},
    effect(run, label) {
      if (typeof label === "string" && label.endsWith(":settings-icon")) {
        const dispose = run();
        if (typeof dispose === "function") iconDisposers.push(dispose);
        return dispose;
      }
      return undefined;
    },
    iconDisposers,
  };
  return ctx;
}

const requireShim = (id) => {
  if (id === "react") return React;
  throw new Error(`unexpected require(${id})`);
};

const bundles = new Map();
async function buildBundle(entry) {
  await mkdir(CACHE, { recursive: true });
  const outfile = join(CACHE, `${entry.replace(/[\\/]/g, "-")}.mjs`);
  const result = await esbuild.build({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    external: ["react", "react/*", "@deepseek-ai/*"],
    jsxFactory: "__dshReact.createElement",
    jsxFragment: "__dshReact.Fragment",
    loader: {  ".ts": "ts", ".tsx": "tsx",".js": "jsx", ".css": "text", ".html": "text", ".svg": "text" },
    logLevel: "silent",
  });
  await writeFile(outfile, result.outputFiles[0].text, "utf8");
  return pathToFileURL(outfile).href;
}

function bundle(entry) {
  if (!bundles.has(entry)) bundles.set(entry, buildBundle(entry));
  return bundles.get(entry);
}

async function load(entry) {
  return import(await bundle(entry));
}

/** Apply one module client with the recording ctx. */
async function mount(module) {
  const loaded = await load(module.entry);
  const slots = recordingSlots();
  const ctx = createCtx(slots);
  if (module.factory) {
    const plugin = loaded.default(requireShim);
    await plugin.apply(ctx);
  } else {
    await loaded.apply(ctx);
  }
  return { slots, ctx };
}

test.after(async () => {
  if (existsSync(CACHE)) await rm(CACHE, { recursive: true, force: true });
});

test("the shared helper registers one glyph for a known section", async () => {
  const { registerSettingsIcon } = await load("src/client/ui/components/settings-icon/index.tsx");
  const slots = recordingSlots();
  const dispose = registerSettingsIcon({ slots }, "boot", "rocket");
  assert.equal(typeof dispose, "function");
  assert.equal(slots.records.length, 1);
  assert.equal(slots.records[0].id, "boot");
  const markup = renderToStaticMarkup(createElement(slots.records[0].Component, { size: 16 }));
  assert.match(markup, /<svg/);
  assert.match(markup, /stroke="currentColor"/);
  assert.match(markup, /data-sk-settings-icon="rocket"/);
  dispose();
  assert.equal(slots.records.length, 0);
  assert.deepEqual(slots.disposed, ["boot"]);
});

test("the shared helper tolerates a missing or throwing slots API", async () => {
  const { registerSettingsIcon } = await load("src/client/ui/components/settings-icon/index.tsx");
  assert.equal(registerSettingsIcon(undefined, "boot", "rocket"), undefined);
  assert.equal(registerSettingsIcon({}, "boot", "rocket"), undefined);
  assert.equal(registerSettingsIcon({ slots: {} }, "boot", "rocket"), undefined);
  assert.equal(registerSettingsIcon({ slots: { inject() {} } }, "boot", "rocket"), undefined);
  assert.equal(registerSettingsIcon({ slots: { inject() {}, register() {} } }, "", "rocket"), undefined);
  assert.equal(registerSettingsIcon({ slots: { inject() {}, register() {} } }, "boot", "nope"), undefined);
  assert.doesNotThrow(() => {
    const result = registerSettingsIcon({
      slots: { inject() { throw new Error("slot is gone"); }, register() {} },
    }, "boot", "rocket");
    assert.equal(result, undefined);
  });
});

for (const module of MODULES) {
  test(`${module.name} client registers its own icon exactly once`, async () => {
    const { slots, ctx } = await mount(module);
    assert.equal(slots.records.length, 1, "one icon per module");
    assert.equal(slots.records[0].id, module.section, "registration id is the module's section id");

    const Component = slots.records[0].Component;
    const markup = renderToStaticMarkup(createElement(Component, { size: 18, active: true }));
    assert.match(markup, /<svg/);
    assert.match(markup, /stroke="currentColor"/);
    assert.match(markup, /fill="none"/);
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, new RegExp(`data-sk-settings-icon="${module.icon}"`));
    assert.match(markup, /width="18"/);
    assert.match(markup, /height="18"/);
    assert.match(markup, /data-active="true"/);

    const defaults = renderToStaticMarkup(createElement(Component));
    assert.match(defaults, /width="16"/);
    assert.match(defaults, /height="16"/);
    assert.match(defaults, /data-active="false"/);

    assert.equal(ctx.iconDisposers.length, 1);
    ctx.iconDisposers[0]();
    assert.equal(slots.records.length, 0, "disposing unregisters the icon");
    assert.deepEqual(slots.disposed, [module.section]);
  });
}
