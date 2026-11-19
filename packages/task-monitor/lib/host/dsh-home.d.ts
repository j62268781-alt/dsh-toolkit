/** 只需要 `DSH_HOME` 这一个字段；测试会传 `{}` 或临时对象进来。 */
export interface DshHomeEnv {
    DSH_HOME?: string | null;
}
/**
 * 当前的 `$DSH_HOME`：环境变量优先（去掉首尾空白，空串等于没配），否则 `~/.dsh`。
 *
 * @param env  环境变量表，默认 `process.env`
 * @param home 家目录，默认 `os.homedir()`；测试用它避开真实 profile
 */
export declare function dshHome(env?: DshHomeEnv, home?: string): string;
//# sourceMappingURL=dsh-home.d.ts.map