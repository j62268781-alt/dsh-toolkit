/**
 * `$DSH_HOME` —— 宿主侧所有「落盘到 profile 目录」的模块共用的唯一实现。
 *
 * 桌面端把 `DSH_HOME` 导进进程环境，命令行跑的时候没有这个变量，两边都要落到
 * `~/.dsh`。这条规则以前在 archived / skills-mcp / remote / mobile / judgment / pet
 * 各写了一遍，连「空串算没配」这种细节都不一致；现在只有这里一处。
 *
 * 每次调用都重新读环境，不做缓存：测试会把一个进程指到临时目录，桌面端也可能在
 * 加载模块之后再改环境变量。
 *
 * 只能给 host 用 —— `node:os` / `node:path` 在浏览器里求值会直接炸（client 侧要用
 * 常量请走 `./paths.js`，那个文件没有任何 import）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 只需要 `DSH_HOME` 这一个字段；测试会传 `{}` 或临时对象进来。 */
export interface DshHomeEnv {
  DSH_HOME?: string | null
}

/**
 * 当前的 `$DSH_HOME`：环境变量优先（去掉首尾空白，空串等于没配），否则 `~/.dsh`。
 *
 * @param env  环境变量表，默认 `process.env`
 * @param home 家目录，默认 `os.homedir()`；测试用它避开真实 profile
 */
export function dshHome(env: DshHomeEnv = process.env, home: string = homedir()): string {
  const fromEnv = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return fromEnv === '' ? join(home, '.dsh') : fromEnv
}
