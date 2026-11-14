import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { resolveElectron, helperEnvironment } from './electron.js';
import { readElectronPath } from './config.js';
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
    async prepare(config, start = false) {
        if (this.disposed)
            return;
        if (this.pending)
            return this.pending;
        const generation = this.generation;
        this.update({ status: 'starting', error: undefined });
        this.pending = (async () => {
            try {
                const binary = await this.resolve({ electronPath: readElectronPath(config), download: true });
                if (this.disposed || generation !== this.generation)
                    return;
                this.update({ available: true, status: 'stopped' });
                if (this.enabled)
                    this.start(binary);
            }
            catch (error) {
                if (!this.disposed && generation === this.generation)
                    this.update({ status: 'error', error: error.message });
            }
        })().finally(() => { this.pending = undefined; });
        return this.pending;
    }
    async configure(config, settings) {
        this.config = config;
        this.enabled = settings.petEnabled || settings.islandEnabled;
        if (!this.enabled) {
            await this.stop();
            return;
        }
        await this.pending;
        if (this.enabled && !this.child && this.state.status !== 'error')
            await this.prepare(this.config, true);
    }
    start(binary) {
        if (this.child || this.disposed || !this.enabled)
            return;
        this.update({ status: 'starting', error: undefined });
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
            if (!this.enabled || this.disposed) {
                this.update({ status: 'stopped' });
                return;
            }
            if (Date.now() - started > 180000)
                this.failures = 0;
            this.failures += 1;
            this.update({ status: 'error', error: diagnostics.trim() || 'Desktop helper exited unexpectedly' });
            if (this.failures <= 3) {
                this.restart = setTimeout(() => { this.restart = undefined; if (this.enabled && !this.disposed)
                    void this.prepare(this.config, true); }, 750 * 2 ** (this.failures - 1));
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
        return this.prepare(config, this.enabled);
    }
    async stop() {
        this.generation += 1;
        clearTimeout(this.restart);
        const child = this.child;
        this.child = undefined;
        if (child)
            await new Promise((resolve) => {
                let timer;
                const done = () => { clearTimeout(timer); resolve(); };
                child.once('exit', done);
                child.kill('SIGTERM');
                timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 3000);
                timer.unref?.();
            });
        this.update({ status: 'stopped', error: undefined });
    }
    async dispose() { this.disposed = true; this.enabled = false; await this.stop(); }
}
//# sourceMappingURL=helper.js.map