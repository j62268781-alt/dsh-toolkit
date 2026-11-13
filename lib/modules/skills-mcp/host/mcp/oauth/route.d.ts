export declare const OAUTH_PATH = "/dsh-skills-mcp-manager/oauth";
/**
 * 注册 OAuth 命令路由。
 *
 * @param ctx - 带 `webServer` / `connection` 的 cordis 上下文。
 * @param options.schema - zod schema（Host 侧定义），`authorize`/`logout` 必填 `serverName`。
 * @param options.run - `(op) => Promise<object>`，已校验的命令交给它执行。
 */
export declare function registerOAuthRoute(ctx: any, { schema, run }: any): void;
//# sourceMappingURL=route.d.ts.map