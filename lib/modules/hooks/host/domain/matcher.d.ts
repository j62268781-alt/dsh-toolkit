export interface MatcherCheck {
    /** 这条 hook 是否应该在该 subject 上运行。 */
    matches: boolean;
    /** 写好但编译不了时给出原因；此时 `matches` 恒为 false。 */
    error?: string;
}
export declare function checkMatcher(matcher: string, subject: string): MatcherCheck;
//# sourceMappingURL=matcher.d.ts.map