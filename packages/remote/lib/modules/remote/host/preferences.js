/**
 * 「移动端」面板的偏好：哪些入口是开着的。
 *
 * 为什么单独落文件而不是写 profile 的 cordis 配置：那些配置是插件加载期读的，
 * 改完要重启 DSH 才生效；面板里的开关必须点完立刻管用，所以状态存在
 * `$DSH_HOME/toolkit/remote-preferences.json`，由本模块在进程内即时应用
 * （微信桥接直接启停，手机入口走 ds-harness-remote 的授权接口）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
const EMPTY = { wechat: false };
function normalize(value, fallback) {
    if (value === null || typeof value !== 'object')
        return { ...fallback };
    return {
        wechat: typeof value.wechat === 'boolean' ? value.wechat : fallback.wechat,
    };
}
/**
 * 同步版本：只在插件加载期用一次。
 *
 * 插件装配顺序里有一步必须「拿到初值再决定起不起微信桥接」，而 cordis 不会等
 * `ctx.effect` 里的异步回调（实测 `await fiber` 之后异步 effect 还没跑完），
 * 于是路由先注册好、服务却还没起来，面板上就闪一下「已关闭」。这里同步读一个
 * 只有几十字节的 JSON，换掉那个竞态。
 */
export function readPreferencesSync(target) {
    try {
        return normalize(JSON.parse(readFileSync(target.path, 'utf8')), target.fallback);
    }
    catch {
        return { ...target.fallback };
    }
}
/** 读偏好；文件不存在或坏掉都退回配置里的默认值，不让面板因此失败。 */
export async function readPreferences(target) {
    try {
        const raw = await readFile(target.path, 'utf8');
        return normalize(JSON.parse(raw), target.fallback);
    }
    catch {
        return { ...target.fallback };
    }
}
/**
 * 写偏好。先写临时文件再 rename：面板可能连点两下开关，
 * 半截文件会让下一次读取把两个开关都当成默认值。
 */
export async function writePreferences(target, next) {
    const value = normalize(next, target.fallback);
    await mkdir(dirname(target.path), { recursive: true });
    const temp = `${target.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, target.path);
    return value;
}
/** 配置里的默认值：没写过偏好文件时，跟插件配置保持一致。 */
export function defaultPreferences(enabled) {
    return { ...EMPTY, wechat: enabled };
}
//# sourceMappingURL=preferences.js.map