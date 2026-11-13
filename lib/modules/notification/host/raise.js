import { spawn } from 'node:child_process';
export function raiseWindow(options = {}) {
    const spawnProcess = options.spawnProcess ?? spawn;
    const execPath = options.execPath ?? process.execPath;
    const versions = options.versions ?? process.versions;
    // 只有桌面壳能这么干：纯 node 部署（`dsh --host`）里再启动一次 execPath 没有意义，
    // 而且 process.execPath 会指向 node 本身。process.versions.electron 是唯一可靠的判据。
    if (typeof versions?.electron !== 'string')
        return false;
    const env = { ...(options.env ?? process.env) };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const child = spawnProcess(execPath, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env,
        });
        // 不 unref 的话宿主退出时会等这个（已经自己退出的）子进程，反而拖慢关闭。
        child?.unref?.();
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=raise.js.map