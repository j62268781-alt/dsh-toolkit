/**
 * 两个 `state` 是否相等，且比较耗时与内容无关。
 *
 * @param expected - 服务端存下的期望值。
 * @param received - 回调 query 里收到的值。
 * @returns 严格相等时为 true；任何非字符串、空串、长度不同都为 false（不抛错）。
 */
export declare function stateMatches(expected: any, received: any): boolean;
/** 生成一个 32 字节的 base64url 随机值（`state` 与 PKCE verifier 都用得上）。 */
export declare function randomToken(bytes?: number): string;
/** 回调 query 里 `state` / `code` 是否都恰好出现一次（重复参数一律拒绝）。 */
export declare function singleParams(searchParams: any): {
    ok: boolean;
    state: any;
    code: any;
    error: any;
    errorDescription: any;
};
//# sourceMappingURL=state.d.ts.map