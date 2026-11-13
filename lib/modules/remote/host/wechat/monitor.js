/**
 * 常驻消息监听：登录成功后用 token 长轮询 getUpdates。
 *
 * 游标（get_updates_buf）默认只存在内存里；如果传了 cursorStore（见 store.js），
 * 则游标会持久化到桥状态文件，重启后不丢。换 token / 换账号时必须清掉游标，
 * 否则首次拉取会跳过历史消息。
 *
 * 明确的取舍：getUpdates 是**消费型**接口，同一账号被两个消费者同时轮询会互相抢消息。
 * 因此只要本插件开着监听，别的桥接（例如 deepseek-harness-weixin）就拿不到同一条消息。
 * 该事实写进 README，并由 panel 的开关暴露给用户。
 */
import { getUpdates, summarizeMessage, STALE_TOKEN_CODE } from './ilink.js';
const DEFAULT_TIMEOUT_MS = 40_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 1_500;
/** 首次 -14 之后多久重试：真抖动 3 秒就够，没必要按半分钟等（等的时候一条消息也进不来）。 */
const STALE_RETRY_MS = 3_000;
/** 判定凭据已失效之后的重试间隔：留一点自愈可能，但不再密集打扰服务端。 */
const STALE_INVALID_RETRY_MS = 60_000;
/** 连续几次 -14 判定凭据失效。2 次 ≈ 6 秒，够区分「抖动」与「token 被作废」。 */
const STALE_INVALID_AFTER = 2;
export const STALE_RETRY_MESSAGE = '微信连接已断开，正在重连…';
export const STALE_INVALID_MESSAGE = '微信连接已失效（可能在其他设备重新登录），请点「重新登录」';
const sleep = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
    }, { once: true });
});
/**
 * 创建一个监听器。
 * @param options.getCredential 每次操作前重新解析凭据（凭据可能被换掉）。
 * @param options.onMessage 收到消息时回调，参数是脱敏摘要与原始消息。
 * @param options.logger 宿主 logger；只记录诊断，不记录消息正文与 token。
 * @param options.cursorStore 可选 { get(): string, set(value: string): void }，用于持久化游标。
 */
export function createMonitor({ getCredential, onMessage, logger, onStateChange = () => { }, cursorStore } = {}) {
    let controller;
    let running = false;
    /**
     * phase 是给界面用的「通道阶段」，比 connected 布尔值多一档信息：
     *   idle       没在监听
     *   connecting 刚启动、还没拿到一次成功的轮询（首轮长轮询最长 40s，这期间不该报红）
     *   live       上一轮长轮询成功
     *   stale      刚收到 -14：已断开，正在快速重连（界面立刻报红）
     *   invalid    连续 -14，token 已失效，需要用户重新登录
     *   error      其它网络/接口错误
     */
    let state = { running: false, connected: false, phase: 'idle', lastError: undefined, received: 0 };
    const setState = (patch) => {
        state = { ...state, ...patch };
        try {
            onStateChange(state);
        }
        catch {
            // 状态回调失败不影响监听。
        }
    };
    async function loop(signal) {
        let cursor = '';
        try {
            cursor = String(cursorStore?.get?.() ?? '');
        }
        catch {
            cursor = '';
        }
        let timeoutMs = DEFAULT_TIMEOUT_MS;
        let failures = 0;
        let staleCount = 0;
        while (!signal.aborted) {
            let credential;
            try {
                credential = await getCredential();
            }
            catch (error) {
                credential = undefined;
            }
            if (credential === undefined) {
                setState({ connected: false, phase: 'error', lastError: '未找到微信凭据' });
                await sleep(RETRY_DELAY_MS, signal);
                continue;
            }
            try {
                const response = await getUpdates({
                    baseUrl: credential.baseUrl,
                    token: credential.token,
                    cursor,
                    timeoutMs,
                    signal,
                });
                if (signal.aborted)
                    return;
                const code = Number(response?.errcode ?? response?.ret ?? 0);
                if (code !== 0) {
                    if (code === STALE_TOKEN_CODE) {
                        // -14 不是「稍后自动恢复」：拿一个故意写错的 token 调 getUpdates，服务端同样秒回
                        // {"errcode":-14,"errmsg":"session timeout"}。所以它只说明「这个 token 现在不被接受」，
                        // 第一次就要把界面切成断开（否则面板绿着、消息一条都进不来，用户毫无察觉），
                        // 再用 3 秒快重试兜住「服务端会话被回收」这种能自愈的情况。
                        staleCount += 1;
                        const invalid = staleCount >= STALE_INVALID_AFTER;
                        setState({
                            connected: false,
                            phase: invalid ? 'invalid' : 'stale',
                            lastError: invalid ? STALE_INVALID_MESSAGE : STALE_RETRY_MESSAGE,
                        });
                        failures = 0;
                        await sleep(invalid ? STALE_INVALID_RETRY_MS : STALE_RETRY_MS, signal);
                        continue;
                    }
                    failures += 1;
                    setState({ connected: false, phase: 'error', lastError: `getUpdates 返回错误码 ${code}` });
                    await sleep(Math.min(RETRY_DELAY_MS * failures, 15_000), signal);
                    continue;
                }
                failures = 0;
                staleCount = 0;
                setState({ connected: true, phase: 'live', lastError: undefined });
                const nextTimeout = Number(response?.longpolling_timeout_ms);
                if (Number.isFinite(nextTimeout) && nextTimeout > 0) {
                    timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, nextTimeout));
                }
                const nextCursor = response?.get_updates_buf;
                if (typeof nextCursor === 'string' && nextCursor !== '' && nextCursor !== cursor) {
                    cursor = nextCursor;
                    try {
                        cursorStore?.set?.(cursor);
                    }
                    catch {
                        // 游标落盘失败不影响监听，下次拉取继续用内存游标。
                    }
                }
                const messages = Array.isArray(response?.msgs) ? response.msgs : [];
                for (const message of messages) {
                    if (signal.aborted)
                        return;
                    let summary;
                    try {
                        summary = summarizeMessage(message);
                    }
                    catch (error) {
                        logger?.warn?.('[remote] 解析消息失败：%s', String(error?.message ?? error));
                        continue;
                    }
                    setState({ received: state.received + 1 });
                    try {
                        onMessage(summary, message);
                    }
                    catch (error) {
                        logger?.warn?.('[remote] 处理消息失败：%s', String(error?.message ?? error));
                    }
                }
            }
            catch (error) {
                if (signal.aborted)
                    return;
                failures += 1;
                setState({ connected: false, phase: 'error', lastError: String(error?.message ?? error) });
                await sleep(Math.min(RETRY_DELAY_MS * failures, 15_000), signal);
            }
        }
    }
    return {
        getState: () => ({ ...state }),
        start() {
            if (running)
                return;
            running = true;
            controller = new AbortController();
            setState({ running: true, connected: false, phase: 'connecting', lastError: undefined });
            void loop(controller.signal);
        },
        stop() {
            if (!running)
                return;
            running = false;
            controller?.abort();
            controller = undefined;
            setState({ running: false, connected: false, phase: 'idle' });
        },
        /** 单次探测（不常驻）：给「测试通道」按钮用。 */
        async probe({ timeoutMs = 10_000 } = {}) {
            let credential;
            try {
                credential = await getCredential();
            }
            catch {
                credential = undefined;
            }
            if (credential === undefined)
                throw new Error('未找到微信凭据，请先连接微信');
            const controllerOnce = new AbortController();
            const timer = setTimeout(() => controllerOnce.abort(), timeoutMs);
            try {
                const response = await getUpdates({
                    baseUrl: credential.baseUrl,
                    token: credential.token,
                    cursor: '',
                    timeoutMs,
                    signal: controllerOnce.signal,
                });
                const code = Number(response?.errcode ?? response?.ret ?? 0);
                if (code === STALE_TOKEN_CODE) {
                    // 单次探测没有「抖动」这一说：token 被拒就是真的用不了了。
                    return { ok: false, reason: STALE_INVALID_MESSAGE, messages: 0, invalid: true };
                }
                if (code !== 0) {
                    return { ok: false, reason: `getUpdates 返回错误码 ${code}`, messages: 0 };
                }
                const messages = Array.isArray(response?.msgs) ? response.msgs : [];
                for (const message of messages) {
                    try {
                        onMessage(summarizeMessage(message), message);
                    }
                    catch {
                        // 探测只关心通道是否可用。
                    }
                }
                return { ok: true, messages: messages.length };
            }
            catch (error) {
                // 长轮询超时视为「通道空闲但可用」。
                if (controllerOnce.signal.aborted)
                    return { ok: true, messages: 0, idle: true };
                throw error;
            }
            finally {
                clearTimeout(timer);
            }
        },
        dispose() {
            this.stop();
        },
    };
}
//# sourceMappingURL=monitor.js.map