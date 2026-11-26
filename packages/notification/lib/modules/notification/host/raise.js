import { spawn } from 'node:child_process';
export function raiseWindow(options = {}) {
    const spawnProcess = options.spawnProcess ?? spawn;
    const execPath = options.execPath ?? process.execPath;
    const versions = options.versions ?? process.versions;
    // 纯 Node 部署没有可提起的桌面窗口。
    if (typeof versions?.electron !== 'string')
        return false;
    let command = execPath;
    let args = [];
    if ((options.platform ?? process.platform) === 'darwin') {
        const app = /^(\/.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1];
        if (!app)
            return false;
        command = '/usr/bin/open';
        args = ['-a', app, 'dsh://open'];
    }
    const env = { ...(options.env ?? process.env) };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const child = spawnProcess(command, args, {
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
