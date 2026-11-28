import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { resolveElectron, helperEnvironment } from './electron.js';
import { readElectronPath } from './config.js';
// A short gap between activities should not force another Electron cold start.
const IDLE_EXIT_DELAY = 30_000;
/**
 * helper 进程入口的绝对路径，分隔符统一成 `/`。
 *
 * spawn 在 Windows 上同样接受 `/`；统一成一种形状，日志、测试断言和跨端排查就不用各自兼容。
 */
function runtimeEntry() {
    return fileURLToPath(new URL('./runtime/main.cjs', import.meta.url)).replace(/\\/g, '/');
}
export class HelperManager {
    onChange;
    bridge;
    resolve;
    launch;
    state;
    child;
    generation;
    enabled;
    disposed;
    failures;
    pending;
    config;
    restart;
    wanted = false;
    idleExit;
    stopping;
    constructor({ onChange, bridge, resolve = resolveElectron, launch = spawn }) {
        this.onChange = onChange;
        this.bridge = bridge;
        this.resolve = resolve;
        this.launch = launch;
        this.state = { status: 'stopped', available: false };
        this.child = undefined;
        this.generation = 0;
        this.enabled = false;
        this.disposed = false;
        this.failures = 0;
    }
    update(patch) {
        // patch 只由本类的调用点给出，取值都在 HelperState 的合法域内。
        this.state = { ...this.state, ...patch };
        this.onChange();
    }
    /**
     * 只探测运行时是否已经就绪，不触发下载。
     *
     * `available` 原先只由 `prepare()`（下载/解压流水线）置 true：桌面端关着、运行时其实
     * 早就装好的机器，设置页会一直显示「首次使用需要准备桌面运行时」。
     * 这里用 `download: false` 只做一次路径检查，不会因为误判又拉一遍 138MB。
     */
    async probe(config) {
        // 正在准备时以 prepare 为准；它结束后会自己写 available，探测结果反而可能是旧的。
        if (this.disposed || this.pending || this.state.status === 'starting' || this.state.status === 'running')
            return;
        const state = this.state;
        // 配置路径无效时只降级为「不可用」；准备或启动后的新状态不能被迟到的探测覆盖。
        const binary = await this.resolve({ electronPath: readElectronPath(config), download: false }).catch(() => undefined);
        if (!this.disposed && this.state === state)
            this.update({ available: !!binary });
    }
    async prepare(config) {
        if (this.stopping)
            await this.stopping;
        if (this.disposed)
            return;
        if (this.pending)
            return this.pending;
        const generation = this.generation;
        this.update({ status: 'starting', error: undefined, progress: undefined });
        this.pending = (async () => {
            try {
                const binary = await this.resolve({
                    electronPath: readElectronPath(config), download: true,
                    // 下载进度直接进 state：`/state` 与 SSE 都带 `runtime`，设置页因此能画进度条，
                    // 而不是整段几分钟只显示「正在准备」。
                    onProgress: (progress) => { if (!this.disposed && generation === this.generation)
                        this.update({ progress }); },
                });
                if (this.disposed || generation !== this.generation)
                    return;
                this.update({ available: true, status: 'stopped', progress: undefined });
                if (this.wanted)
                    this.start(binary);
            }
            catch (error) {
                if (!this.disposed && generation === this.generation)
                    this.update({ status: 'error', error: error.message, progress: undefined });
            }
        })().finally(() => { this.pending = undefined; });
        return this.pending;
    }
    async configure(config, settings, hasActivity = false) {
        this.config = config;
        this.enabled = settings.petEnabled || settings.islandEnabled;
        if (!this.enabled) {
            this.wanted = false;
            await this.stop();
            await this.probe(config);
            return;
        }
        const updating = this.setActivity(settings, hasActivity);
        // A sleeping helper can still have a runtime installed.
        if (!this.wanted && !this.child)
            await this.probe(config);
        await updating;
    }
    async setActivity(settings, hasActivity) {
        if (this.disposed)
            return;
        this.wanted = this.enabled && (settings.petEnabled || settings.islandEnabled && (settings.islandIdle !== false || hasActivity));
        if (!this.wanted) {
            if (this.child && !this.idleExit) {
                this.idleExit = setTimeout(() => {
                    this.idleExit = undefined;
                    if (!this.wanted)
                        void this.stop();
                }, IDLE_EXIT_DELAY);
                this.idleExit.unref?.();
            }
            return;
        }
        clearTimeout(this.idleExit);
        this.idleExit = undefined;
        // If activity arrives during SIGTERM, wait for the old process to finish before spawning again.
        await this.stopping;
        await this.pending;
        if (this.wanted && !this.disposed && !this.child && this.state.status !== 'error')
            await this.prepare(this.config);
    }
    start(binary) {
        if (this.child || this.disposed || !this.wanted || this.stopping)
            return;
        this.update({ status: 'starting', error: undefined, progress: undefined });
        let child;
        try {
            // binary 可能是 undefined（下载未启用或找不到）：spawn 会立刻抛错，由下面的 catch 转成 error 状态。
            child = this.launch(binary, [runtimeEntry()], {
                cwd: tmpdir(), env: helperEnvironment(this.bridge.url, this.bridge.token), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
            });
        }
        catch (error) {
            this.update({ status: 'error', error: error.message });
            return;
        }
        this.child = child;
        let buffer = '', diagnostics = '';
        const started = Date.now();
        const timeout = setTimeout(() => {
            if (this.child === child && this.state.status === 'starting') {
                this.update({ status: 'error', error: 'Desktop helper did not become ready' });
                child.kill();
            }
        }, 20000);
        timeout.unref?.();
        child.stdout?.on('data', (chunk) => {
            buffer = (buffer + chunk.toString()).slice(-8192);
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                try {
                    if (JSON.parse(line).type === 'ready' && this.child === child) {
                        clearTimeout(timeout);
                        this.update({ status: 'running', error: undefined });
                    }
                }
                catch { /* Nonprotocol output is ignored. */ }
            }
        });
        child.stderr?.on('data', (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-2000); });
        child.on('error', (error) => { diagnostics = error.message; });
        const finished = () => {
            clearTimeout(timeout);
            if (this.child !== child)
                return;
            this.child = undefined;
            if (!this.wanted || this.disposed) {
                this.update({ status: 'stopped' });
                return;
            }
            if (Date.now() - started > 180000)
                this.failures = 0;
            this.failures += 1;
            this.update({ status: 'error', error: diagnostics.trim() || 'Desktop helper exited unexpectedly' });
            if (this.failures <= 3) {
                this.restart = setTimeout(() => {
                    this.restart = undefined;
                    if (this.wanted && !this.disposed)
                        void this.prepare(this.config);
                    else if (!this.disposed)
                        this.update({ status: 'stopped', error: undefined });
                }, 750 * 2 ** (this.failures - 1));
                this.restart.unref?.();
            }
        };
        child.once('exit', finished);
        child.once('error', finished);
    }
    async retry(config) {
        clearTimeout(this.restart);
        this.failures = 0;
        await this.stop();
        await this.pending;
        return this.prepare(config);
    }
    async stop() {
        clearTimeout(this.idleExit);
        this.idleExit = undefined;
        if (this.stopping)
            return this.stopping;
        this.generation += 1;
        clearTimeout(this.restart);
        this.restart = undefined;
        const child = this.child;
        this.child = undefined;
        if (!child) {
            this.update({ status: 'stopped', error: undefined, progress: undefined });
            return;
        }
        this.stopping = new Promise((resolve) => {
            const done = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 3000);
            timer.unref?.();
            child.once('exit', done);
            child.kill('SIGTERM');
        }).then(() => {
            this.stopping = undefined;
            this.update({ status: 'stopped', error: undefined, progress: undefined });
        });
        return this.stopping;
    }
    async dispose() { this.disposed = true; this.enabled = false; this.wanted = false; await this.stop(); }
}
