/** The directory holding this plugin's own backup artifacts. */
export declare function backupDir(): string;
/**
 * Where the previous patch content is kept: a single rolling file.
 *
 * One file, not one per write. The backup exists to undo *the operation that just
 * ran* — its job is to hold the content that was in place immediately before the
 * current one — so a second, third and hundredth copy of the same bytes buys
 * nothing. The previous scheme wrote a timestamped copy on every write and had
 * accumulated 135 files holding only 5 distinct contents (130 of them byte-identical
 * duplicates, one content repeated 99 times), which is noise, not safety.
 *
 * The trade-off, stated plainly: a rolling file only goes back one step. If a write
 * goes wrong *and* you save again before noticing, the good state is overwritten by
 * the bad one. Versioned history would cover that, but at the cost that made this
 * unreadable in the first place; a config file is also under the user's own version
 * control and DSH's profile backups, which is where long-range history belongs.
 */
export declare function backupPath(): string;
/**
 * MCP rows the active profile already configures with the shipped client.
 *
 * Read from the Loader (the panel's own settings document cannot see them,
 * because those rows declare no volatile fields), reduced to what a panel row
 * needs to show.
 */
export declare const YAML_JS_TAG: {
    tag: string;
    resolve: (value: any) => any;
};
/**
 * 用户填的环境变量：**原样保留，一个字节都不注入**。
 *
 * ## 为什么不把 PATH 写进 profile
 *
 * 曾经这里是 `spawnEnv(env)` —— 它会把宿主机整条 PATH 塞进行的 `env` 里，理由是桌面启动的
 * Host 环境里 `PATH=/usr/bin:/bin:/usr/sbin:/sbin`，不含 `node`，stdio 行会死在
 * `#!/usr/bin/env node` 上。那个理由是真的，但**解法放错了层**：
 *
 *   · 后果一：profile 里出现 `PATH=/Users/<某人>/…`。这份配置拷到另一台机器就是错的，
 *     而它看起来只是一行普通环境变量，没人会想到要删；
 *   · 后果二：面板的「环境变量」文本框会把这几百字符**显示给用户**（用户并不需要看见，
 *     也不该编辑它）；
 *   · 后果三：每次保存都把它再写一遍，diff 里永远是噪音。
 *
 * PATH 属于**运行环境**，不是配置。所以现在只在这里存用户填的东西，PATH 由启动子进程时
 * 注入 —— 那一步本来就在做，而且做得更对（`stdioMountConfig` 会把
 * `npx -y <pkg>` 换成 `<内置 runtime 的 node> <pnpx.mjs> <pkg>`，并把 runtime 的 bin
 * 目录放进子进程 PATH）。落到 yml 里的那份从来是冗余的。
 *
 * @param env - 用户填写的变量（`parseEnv` 的结果）。
 * @returns 同一组变量，不做任何注入。
 */
export declare function userEnvOnly(env: any): any;
/** Inject the host's file-lock / atomic-write implementation. */
export declare function setPatchIO(next: any): void;
/**
 * Keep the content that was in place before the write about to happen.
 *
 * Overwrites the single rolling file (see {@link backupPath}) — no timestamped
 * copies, so a day of panel edits leaves exactly one file instead of 135.
 */
export declare function backupPatch(before: any): Promise<void>;
/**
 * One legacy panel server entry → one profile row.
 *
 * Shared by the raw-patch migration and by `migrateServerEntries` (kept for tests): the
 * conversion must not exist twice, or the two paths would produce different rows for the
 * same entry.
 */
export declare function legacyServerRowConfig(entry: any): {
    id: string;
    config: any;
    projectScoped: boolean;
};
/**
 * One-time migration of everything this plugin used to keep in its own `config`.
 *
 * Three moves, in one locked pass over the raw profile patch:
 *
 *   · `config.servers[]`  → ordinary `mcp-client` rows (the same conversion the panel's
 *                           add path uses, so a migrated row is byte-identical to a hand
 *                           added one);
 *   · `config.skills[]`   → `<root>/<name>/SKILL.md` files (the old reconcile output). A
 *                           file that already exists wins — the config is only a seed for
 *                           the conversion, never an overwrite;
 *   · every read-model / command / projection key → **removed**. Those values now live in
 *                           `/runtime` (recomputed per request) or in the HTTP routes, so
 *                           nothing transient stays in `cordis.patch.yml`.
 *
 * Runs while holding the same lock as every other patch write, and is idempotent: the keys
 * are gone after the first successful pass, so the next call is a no-op.
 *
 * @returns the number of changed fields/entries, or 0 when there was nothing to do.
 */
export declare function migratePanelConfig(ctx: any): Promise<any>;
export declare function applyRowOp(ctx: any, op: any): Promise<any>;
/**
 * Turn this plugin's legacy `config.servers` entries into `mcp-client` rows.
 *
 * ## Why every entry becomes a row
 *
 * Project servers used to live in a field this plugin owned, while global ones were rows.
 * Both tiers are rows now, and `scope` says which is which — so the migration converts
 * *every* legacy entry, including the global ones, or the two sources would still coexist
 * for exactly the servers the user sees first.
 *
 * ## Shape mapping
 *
 * The legacy entry is a panel-shaped object (`args` as a string, `env`/`headers` as
 * `KEY=VALUE` lines); a row's config is the client's shape (an argv array, dicts). The
 * conversion reuses the same helpers `applyRowOp` uses for the add path, so a migrated row
 * is byte-for-byte what adding the same server by hand would produce.
 *
 * @returns `{ migrated, ids }` — the number of rows written and their entry ids.
 */
export declare function migrateServerEntries(ctx: any, entries: any): Promise<any>;
//# sourceMappingURL=apply.d.ts.map