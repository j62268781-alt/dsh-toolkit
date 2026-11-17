/**
 * 引擎失败。（名字沿用旧模块的 `CliError`：循环里的 `error.code` 分类逻辑照搬，不值得为此改名。）
 *
 * `code` 只写稳定短标识，人看的文案放 `message` —— 不要为了本地化去改 code。
 */
export class CliError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'CliError';
        this.code = code;
    }
}
//# sourceMappingURL=engine.js.map