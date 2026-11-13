/**
 * MCP connection-policy fields: `failOnStartupError` plus the `reconnect` block.
 *
 * These are ordinary fields of a `@deepseek-ai/dsh-mcp-client` config, and the
 * plugin has two ways to write one — a profile row edited in the patch file, and
 * a panel-managed server mounted straight into the client. Both paths funnel
 * their numbers through here so the accepted range is defined once.
 *
 * The bounds mirror the client's own zod schema (`Reconnect` in dsh-mcp-client):
 * `initialDelayMs` / `maxDelayMs` are `min(1).max(2147483647)`, `maxAttempts` is
 * an integer `min(1)`. A value outside that range makes the row fail to load, so
 * the panel's text is validated here rather than written on trust.
 */
/** Inclusive bounds the MCP client accepts, per reconnect field. */
export declare const CONNECTION_BOUNDS: Readonly<{
    initialDelayMs: Readonly<{
        min: 1;
        max: 2147483647;
    }>;
    maxDelayMs: Readonly<{
        min: 1;
        max: 2147483647;
    }>;
    maxAttempts: Readonly<{
        min: 1;
        max: number;
    }>;
    toolCallTimeoutMs: Readonly<{
        min: 1;
        max: 2147483647;
    }>;
}>;
/** What the client applies when a field is absent (the form shows these as hints). */
export declare const CONNECTION_DEFAULTS: Readonly<{
    failOnStartupError: false;
    initialDelayMs: 500;
    maxDelayMs: 30000;
    maxAttempts: 10;
    toolCallTimeoutMs: 60000;
}>;
/**
 * The reconnect numbers the form starts from, as strings.
 *
 * Panel field name -> default, so a new server's form opens on the values the client would
 * have applied anyway. Kept beside `CONNECTION_DEFAULTS` so the two cannot drift: these are
 * literally that object, re-keyed into the panel's flat naming.
 */
export declare const CONNECTION_DRAFT_DEFAULTS: Readonly<{
    reconnectInitialDelayMs: string;
    reconnectMaxDelayMs: string;
    reconnectMaxAttempts: string;
    toolCallTimeoutMs: string;
    /**
     * 明文 token 端点的例外默认为 **false**，与数字字段不同：数字要有「客户端默认值」可以
     * 对齐，而这个开关的默认就是不放宽安全。所以这里放布尔而不是字符串。
     */
    allowInsecureTokenEndpoint: false;
}>;
/**
 * Panel field name -> config field name.
 *
 * The panel's draft is flat (one string per input), the config nests the three
 * numbers under `reconnect`.
 */
export declare const RECONNECT_FIELDS: Readonly<{
    reconnectInitialDelayMs: "initialDelayMs";
    reconnectMaxDelayMs: "maxDelayMs";
    reconnectMaxAttempts: "maxAttempts";
}>;
export declare function connectionFields(source: any): any;
/**
 * Render a config number back into the panel's flat draft shape.
 *
 * A number the row does not set becomes the client's default rather than a blank, so the form
 * always shows the value that will actually be used. A blank input would say "unset" while the
 * client silently applies 500 — the user could not tell what the row does without reading
 * another package's source. `connectionFields` writes the same numbers, so the form and the
 * file cannot disagree.
 */
export declare function connectionDraftOf(config: any): any;
//# sourceMappingURL=connection.d.ts.map