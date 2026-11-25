// 只有声明了 `wire` 的投影才会被 snapshot 折叠并推给插件。实测（DSH 0.2.2-rc.5，desktop 宿主）
// 能拿到的只有下面这 7 个键：turnOutline / contextBreakdown / todos 虽然在包里声明了 wire，
// 但这个宿主没有把它们注册成可读单元，snapshot 永远返回 undefined；sessionStats /
// contextPressure / llmRetry / turnBoundary 干脆是 Host-only。所以累计输出从 tokenUsage 取，
// 回合号、步骤、当前工具只能回读会话日志的尾页（见 readTail）。
// approval 没有 wire 投影，靠自己的 scoped waterfall 观察。
const KEYS = ['title', 'sessionListMetadata', 'inbox', 'goal', 'userQuestions', 'tokenUsage', 'conversationContinuation'];
const text = (value, limit = 240) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const time = (value) => Number.isFinite(value) ? value : 0;
// 灵动岛/桌宠展示的是「实时活动」：结束或暂停的会话只留最近半小时，判定为「正在跑」的
// 最多留 6 小时 —— 否则几天前就停下的会话（典型是暂停的 goal、或崩溃前残留的 running）
// 会一直占着首屏，看着像「显示了一个旧会话」。等人的审批/提问则永不按时间淘汰。
const STALE_FINISHED = 30 * 60 * 1000;
const STALE_RUNNING = 6 * 60 * 60 * 1000;
const TICK = 60 * 1000;
// 尾页回读：消息条数与最小间隔（热态 1–2ms，冷态约 80ms，按会话限流）。
const TAIL_MESSAGES = 40;
const TAIL_INTERVAL = 3000;
// 没有事件也要补读：宿主重启后已有会话不会补发 status/activity。
const TAIL_SWEEP = 5000;
/** `ctx` 是宿主插件上下文（形状由宿主决定），故显式 any。 */
export function createActivityFeed(ctx, onChange = () => { }, options = {}) {
    // 用户已经点开看过的会话：记录「看到时的活动时间」。之后只要没有新动作（updatedAt 前进）
    // 或重新跑起来，就不该再以「有新结果 / 需要你处理」的形式占着灵动岛。
    const seen = options.seen instanceof Map ? options.seen : new Map();
    const rows = new Map();
    const removals = new Set();
    // 正在回读结束原因的会话（同一条会话不要并发读同一页日志）。
    const endings = new Set();
    const tailsQueued = new Set();
    const disposers = [];
    const abort = new AbortController();
    const boots = [];
    // 会话摘要里的 running 是**持久化**的：DSH 被强杀/重启后，被杀掉那一回合的会话仍然带着
    // running:true，光看摘要就会永远显示「正在工作」。真正的运行回合一定对应本进程里活着的
    // Session，所以只信任「活会话 + 摘要」的交集，其余交给 api-session/status 事件。
    const liveIds = new Set();
    // 本进程确实发过事件（added/status/activity/error）的会话才算「这几分钟内真跑过」：插件启动时
    // ctx.sessions.list() 可能还是空的，不能因为那一刻没列出来就把正在跑的会话当成结束态；
    // 反过来，摘要里持久化的 running 单独出现（重启后残留）也不足以说明它现在还在跑。
    const eventLive = new Set();
    const LIVE_FRESH = 10 * 60 * 1000;
    let refreshing = false;
    let disposed = false;
    let loading = true;
    let journal = [];
    let current = [];
    const warn = (message, error) => ctx.logger?.warn?.(`pet activity: ${message}: ${String(error)}`);
    const refreshLive = () => {
        liveIds.clear();
        try {
            for (const session of ctx.sessions.list())
                liveIds.add(session.id);
        }
        catch (error) {
            warn('live session list unavailable', error);
        }
    };
    const ensure = (id) => {
        let row = rows.get(id);
        if (!row) {
            const session = ctx.sessions.get(id);
            row = { sessionId: id, blank: true, running: false, updatedAt: time(session?.header.createdAt), values: {}, versions: {}, pending: new Map(), ...headerFields(session) };
            rows.set(id, row);
        }
        return row;
    };
    const mergeProjection = (row, key, value, seq) => {
        if (!KEYS.includes(key) || seq < (row.versions[key] ?? -Infinity))
            return;
        row.values[key] = value;
        row.versions[key] = seq;
        if (key === 'sessionListMetadata') {
            row.blank = value?.blank ?? row.blank;
            row.updatedAt = Math.max(row.updatedAt, time(value?.lastPromptAt));
        }
    };
    const mergeSummary = (summary) => {
        if (!summary?.sessionId)
            return;
        const row = ensure(summary.sessionId);
        const { projections, ...fields } = summary;
        Object.assign(row, fields);
        row.updatedAt = time(row.updatedAt);
        removals.delete(row.sessionId);
        const seq = projections?.kind === 'sequenced' ? projections.asOfSeq : -Infinity;
        for (const key of KEYS)
            if (Object.hasOwn(projections?.values ?? {}, key))
                mergeProjection(row, key, projections.values[key], seq);
    };
    // 摘要里的 running 是持久化状态，重启后可能残留。真正的权威来源是宿主会话状态
    // （sessionController.state 的 `running`），它对每个可见会话都是现算的。
    const refreshStates = async () => {
        if (refreshing || disposed)
            return;
        refreshing = true;
        try {
            for (const row of rows.values()) {
                if (disposed)
                    return;
                try {
                    const state = await ctx.sessionController.state({ sessionId: row.sessionId }, abort.signal);
                    if (disposed)
                        return;
                    row.verified = true;
                    row.running = Boolean(state?.running);
                    if (row.running)
                        row.error = undefined;
                }
                catch { }
            }
        }
        finally {
            refreshing = false;
        }
        publish();
    };
    const publish = () => {
        if (disposed)
            return;
        refreshLive();
        const now = Date.now();
        const children = new Map();
        for (const row of rows.values()) {
            if (row.origin !== 'subagent' || !row.parentSessionId)
                continue;
            const list = children.get(row.parentSessionId) ?? [];
            list.push(row);
            children.set(row.parentSessionId, list);
        }
        const aggregate = (row, seen = new Set()) => {
            // 成环保护：这个结果只参与下面的 `||=` 合并（waiting/detail/pending/error 都是「无」），不会进快照。
            if (seen.has(row.sessionId))
                return { running: false, waiting: false, pending: undefined, error: undefined, detail: '', updatedAt: 0, waitReason: undefined, queued: 0, interrupted: false, progress: {}, continuable: false };
            seen.add(row.sessionId);
            const own = facts(row, { liveIds, eventLive, now, freshMs: LIVE_FRESH });
            for (const child of children.get(row.sessionId) ?? []) {
                // 子行自己都陈旧了就不再参与聚合，否则几天前卡住的 subagent 会一直把父会话算成「正在跑」。
                if (now - child.updatedAt > STALE_RUNNING)
                    continue;
                const next = aggregate(child, seen);
                own.running ||= next.running;
                if (next.waiting && !own.waiting) {
                    own.waiting = true;
                    own.detail = next.detail;
                    own.waitReason = next.waitReason;
                }
                own.error ||= next.error;
                // 子代理并行时队列条数要累加，否则徽标只报主会话那一条。
                own.queued += next.queued;
                own.interrupted ||= next.interrupted;
                // 子代理正在跑时徽标要能看出「不止一个在干活」，否则并行度完全不可见。
                if (next.running)
                    own.progress.subagents = (own.progress.subagents ?? 0) + 1;
                own.updatedAt = Math.max(own.updatedAt, next.updatedAt);
                if (next.pending && (!own.pending || next.pending.kind === 'permission'))
                    own.pending = next.pending;
            }
            return own;
        };
        const next = [];
        for (const row of rows.values()) {
            if (row.origin === 'subagent' || row.blank)
                continue;
            const state = aggregate(row);
            // 等人处理的（审批 / 提问）无论多久都保留；其余按「正在跑 / 已结束」两个时间窗淘汰。
            if (!state.pending && now - state.updatedAt > (state.running ? STALE_RUNNING : STALE_FINISHED))
                continue;
            // 看过的结果不再提醒；出现新动作、重新跑起来、或等人处理时都会自己回到列表。
            if (!state.running && !state.pending && (seen.get(row.sessionId) ?? 0) >= state.updatedAt)
                continue;
            // 重试中仍是「在跑」，所以只作为 running 的细分；可继续则是一个独立的结束态
            // （宿主清掉 error 事件后，只有 conversationContinuation 还记得上一回合是失败的）。
            const status = state.pending || state.waiting ? 'waiting'
                : state.running ? 'running'
                    : state.error ? 'failed' : state.continuable ? 'continuable' : state.interrupted ? 'interrupted' : 'completed';
            next.push({ id: row.sessionId, title: text(row.values.title, 160) || 'Untitled session', status,
                detail: state.pending?.detail || (status === 'failed' ? text(state.error) : state.detail),
                updatedAt: state.updatedAt, running: state.running,
                ...(state.pending ? { pendingKind: state.pending.kind } : {}),
                ...(state.waitReason ? { waitReason: state.waitReason } : {}),
                ...(state.queued ? { queued: state.queued } : {}),
                ...(Object.keys(state.progress).length ? { progress: state.progress } : {}) });
        }
        const rank = { waiting: 0, running: 1, failed: 2, continuable: 2, interrupted: 2, completed: 2 };
        next.sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
        const bounded = next.slice(0, 20);
        if (JSON.stringify(bounded) === JSON.stringify(current))
            return;
        current = bounded;
        try {
            onChange();
        }
        catch (error) {
            warn('subscriber failed', error);
        }
    };
    // 没有新事件时也要让过期会话自己消失（只依赖事件驱动的话，停止活动后就永远不会重算）。
    const tick = setInterval(() => { publish(); void refreshStates(); }, TICK);
    tick.unref?.();
    const mutate = (operation) => {
        if (disposed)
            return;
        if (loading)
            journal.push(operation);
        operation();
        publish();
    };
    const listen = (event, callback, options = {}) => {
        const dispose = ctx.on(event, callback, { global: true, ...options });
        if (typeof dispose === 'function')
            disposers.push(dispose);
    };
    // 宿主不广播 turn/end，也没有可读的 sessionStats，所以「用户按了停止」和「第几步、在跑什么工具」
    // 都只能回读会话日志的尾页。一次回读同时拿三样东西，节流到 TAIL_INTERVAL：热态实测 1–2ms，
    // 冷态（首次加载某个会话）约 80ms，所以只在需要时按会话限流，不跟着每一帧走。
    const readTail = async (id, force = false) => {
        const controller = ctx.sessionController;
        if (disposed || typeof controller?.events !== 'function')
            return;
        const row = rows.get(id);
        if (!force && row && Date.now() - (row.tailAt ?? 0) < TAIL_INTERVAL)
            return;
        // 同一会话只跑一次回读；期间再来的请求排队，等这次落地后补一次，免得错过 turn/end。
        if (endings.has(id)) {
            tailsQueued.add(id);
            return;
        }
        endings.add(id);
        try {
            const page = await controller.events({ address: { kind: 'session', sessionId: id }, maxMessages: TAIL_MESSAGES }, abort.signal);
            if (disposed)
                return;
            const target = rows.get(id);
            if (!target)
                return;
            const events = (page?.records ?? [])
                .map((record) => record?.event)
                .filter((event) => Number.isFinite(event?.seq))
                .sort((a, b) => a.seq - b.seq);
            let latest;
            const open = new Map();
            let turn;
            let step;
            let tool;
            for (const event of events) {
                if (event.type === 'turn/start')
                    open.clear();
                else if (event.type === 'step/start' || event.type === 'tool/call') {
                    if (Number.isFinite(event.data?.turn))
                        turn = Number(event.data.turn);
                    if (Number.isFinite(event.data?.step))
                        step = Number(event.data.step);
                }
                if (event.type === 'tool/call') {
                    const callId = String(event.data?.callId ?? '');
                    const name = text(event.data?.name, 32);
                    if (callId && name)
                        open.set(callId, name);
                    if (callId && name && (!tool || event.seq >= tool.seq))
                        tool = { name, seq: event.seq };
                }
                else if (event.type === 'tool/result') {
                    const callId = String(event.data?.callId ?? '');
                    if (callId)
                        open.delete(callId);
                }
                else if (event.type === 'turn/end') {
                    const kind = event.data?.reason?.kind;
                    if (typeof kind === 'string' && (!latest || event.seq >= latest.seq))
                        latest = { kind, seq: event.seq };
                    open.clear();
                }
            }
            const running = [...open.keys()];
            const tail = {
                ...(Number.isFinite(turn) ? { turn } : {}),
                ...(Number.isFinite(step) ? { step } : {}),
                ...(running.length && tool ? { tool: tool.name } : {}),
            };
            const changedTail = JSON.stringify(tail) !== JSON.stringify(target.tail ?? {});
            const changedEnding = Boolean(latest) && (!target.ending || latest.seq > target.ending.seq);
            target.tail = tail;
            target.tailAt = Date.now();
            if (changedEnding)
                target.ending = latest;
            if (changedTail || changedEnding)
                publish();
        }
        catch (error) {
            if (!disposed)
                warn(`session tail unavailable for ${id}`, error);
        }
        finally {
            endings.delete(id);
            if (tailsQueued.delete(id) && !disposed)
                void readTail(id, true);
        }
    };
    // 事件不是唯一入口：宿主重启时已经在跑的会话不会补发 status/activity（实测启动后 16 秒
    // 一个事件都没有），只靠监听就永远不会读到它们的尾页。所以定时补扫在跑或刚更新过的会话，
    // 单次回读的开销由 readTail 的按会话节流兜住。
    const sweep = setInterval(() => {
        if (disposed)
            return;
        const at = Date.now();
        for (const row of rows.values()) {
            if (row.origin === 'subagent' || row.blank)
                continue;
            if (!row.running && at - row.updatedAt > LIVE_FRESH)
                continue;
            void readTail(row.sessionId);
        }
    }, TAIL_SWEEP);
    sweep.unref?.();
    listen('api-session/added', (summary) => mutate(() => {
        if (summary?.sessionId)
            eventLive.add(summary.sessionId);
        mergeSummary(summary);
    }));
    listen('api-session/status', (id, running) => {
        mutate(() => {
            if (removals.has(id))
                return;
            // 能收到本进程的状态事件，本身就说明这个会话是活的（比摘要里的持久化 running 可信）。
            eventLive.add(id);
            const row = ensure(id);
            row.verified = true;
            row.running = running;
            // 新回合开始就丢掉上一回合的结束原因，否则「已停止」会一直挂在这条会话上。
            if (running) {
                row.error = undefined;
                row.blank = false;
                row.ending = undefined;
            }
            row.updatedAt = Math.max(row.updatedAt, Date.now());
        });
        if (!disposed)
            void readTail(id, !running);
    });
    listen('api-session/activity', (id, updatedAt) => {
        mutate(() => {
            if (removals.has(id))
                return;
            eventLive.add(id);
            const row = ensure(id);
            row.updatedAt = Math.max(row.updatedAt, time(updatedAt));
            row.error = undefined;
        });
        if (!disposed)
            void readTail(id);
    });
    listen('api-session/error', (id, error) => mutate(() => {
        if (removals.has(id))
            return;
        eventLive.add(id);
        const row = ensure(id);
        row.error = text(error) || 'Session failed';
        row.running = false;
        row.updatedAt = Math.max(row.updatedAt, Date.now());
    }));
    listen('api-session/removed', (id) => mutate(() => { rows.delete(id); removals.add(id); }));
    disposers.push(ctx.sessionProjections.onChanged((session, key, value, seq) => {
        if (!KEYS.includes(key))
            return;
        mutate(() => {
            if (removals.has(session.id))
                return;
            const row = ensure(session.id);
            Object.assign(row, headerFields(session));
            mergeProjection(row, key, value, seq);
        });
    }));
    // Observe before an answerer consumes the waterfall. Delegate exactly once,
    // preserving its result or rejection; never grants or answers a request.
    for (const [event, kind] of [['approval/request', 'permission'], ['user-questions/request', 'question']]) {
        listen(event, async (request, next) => {
            const id = request.agent?.session?.id;
            if (!id || disposed)
                return next();
            const token = Symbol(kind);
            mutate(() => ensure(id).pending.set(token, { kind, detail: kind === 'permission' ? text(request.reason) || 'Permission requested' : text(request.questions?.[0]?.question) || 'Answer requested' }));
            try {
                return await next();
            }
            finally {
                mutate(() => rows.get(id)?.pending.delete(token));
            }
        }, { prepend: true });
    }
    const ready = (async () => {
        try {
            const baseline = await ctx.sessionController.list({}, abort.signal);
            if (disposed)
                return;
            rows.clear();
            removals.clear();
            for (const summary of baseline.items)
                mergeSummary(summary);
            // Cold list reads can yield. Replay notifications since subscription so
            // removals, status, and per-key projection versions win over old rows.
            for (const operation of journal)
                operation();
            for (const session of ctx.sessions.list()) {
                if (removals.has(session.id))
                    continue;
                const row = ensure(session.id);
                Object.assign(row, headerFields(session));
                try {
                    const block = ctx.sessionProjections.snapshot(session, KEYS);
                    for (const key of KEYS)
                        if (Object.hasOwn(block.values, key))
                            mergeProjection(row, key, block.values[key], block.asOfSeq);
                }
                catch (error) {
                    warn(`projection baseline unavailable for ${session.id}`, error);
                }
            }
        }
        catch (error) {
            if (!disposed)
                warn('list baseline unavailable; continuing with live events', error);
        }
        finally {
            loading = false;
            journal = [];
            publish();
            // 插件往往比「当前会话恢复成活会话」更早启动：几次短延迟重算，别让真正在跑的会话
            // 因为那一刻还不在 live 集合里而被当成结束态。
            void refreshStates();
            for (const delay of [1500, 5000, 15000]) {
                const timer = setTimeout(publish, delay);
                timer.unref?.();
                boots.push(timer);
            }
        }
    })();
    const markSeen = (sessionId, at = Date.now()) => {
        if (disposed || !sessionId)
            return;
        seen.set(sessionId, at);
        try {
            options.onSeen?.(sessionId, at);
        }
        catch (error) {
            warn('seen persistence failed', error);
        }
        publish();
    };
    const inspect = (sessionId) => {
        const row = rows.get(sessionId);
        if (!row)
            return undefined;
        const inbox = row.values.inbox;
        const counts = (value) => (Array.isArray(value) ? value.length : value == null ? 0 : 1);
        return {
            running: row.running, verified: row.verified, updatedAt: row.updatedAt,
            inbox: inbox ? { 'next-turn': counts(inbox['next-turn']), 'next-step': counts(inbox['next-step']) } : null,
            goal: row.values.goal?.goal ? { phase: row.values.goal.goal.phase, roundsStarted: row.values.goal.roundsStarted, updatedAt: row.values.goal.updatedAt } : null,
            pending: row.pending.size,
        };
    };
    return {
        snapshot: () => current.map((row) => ({ ...row })), markSeen, ready, inspect,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            abort.abort();
            clearInterval(tick);
            for (const timer of boots)
                clearTimeout(timer);
            boots.length = 0;
            for (const dispose of disposers.reverse())
                dispose?.();
            rows.clear();
            removals.clear();
            journal = [];
            current = [];
        },
    };
}
// 队列 / goal 顶替权威 running 的抗竞态窗口：跨回合只会差这么一瞬。
const QUEUE_GRACE = 20 * 1000;
function headerFields(session) {
    return session ? { origin: session.header.origin, parentSessionId: session.header.parentSession } : {};
}
function facts(row, { liveIds = new Set(), eventLive = new Set(), now = Date.now(), freshMs = 10 * 60 * 1000 } = {}) {
    const inbox = row.values.inbox;
    const goal = row.values.goal;
    // 队列里的输入不能单独证明「回合在跑」：真机上见过被中断的会话留着一条 next-step，
    // 宿主明明 running=false / queue=1，压了 4 分钟岛上还显示「正在工作」。
    // 所以队列与 goal 只允许在极短窗口内顶替权威 running（跨回合的那一瞬），
    // 超过窗口还没跑起来，说明它只是压在那里等人处理。
    const queueCount = (inbox?.['next-turn']?.length ?? 0) + (inbox?.['next-step']?.length ?? 0);
    const queued = queueCount > 0;
    const quiet = now - row.updatedAt;
    const starting = queued && quiet <= QUEUE_GRACE;
    const activeGoal = goal?.goal?.phase === 'active';
    const exhausted = activeGoal && goal.roundsStarted >= goal.goal.maxGoalRounds;
    // 「现在还在跑」= 本进程见过它的事件，或它确实是活会话且摘要刚刚更新过。
    const live = row.verified === true || eventLive.has(row.sessionId) || liveIds.has(row.sessionId) && quiet <= freshMs;
    const runningNow = Boolean(row.running && live);
    const goalStarting = activeGoal && !exhausted && now - Math.max(row.updatedAt, time(goal?.updatedAt)) <= QUEUE_GRACE;
    const stuckQueue = queued && !runningNow && !starting;
    const pending = [...row.pending.values()].sort((a, b) => (a.kind === 'permission' ? 0 : 1) - (b.kind === 'permission' ? 0 : 1))[0]
        ?? (row.values.userQuestions?.active?.length ? { kind: 'question', detail: text(row.values.userQuestions.active[0].questions?.[0]?.question) || 'Answer requested' } : undefined);
    const waiting = goal?.goal?.phase === 'paused' || goal?.goal?.phase === 'blocked' || exhausted && !row.running && !queued || stuckQueue;
    // 等待的原因要一起带出去：徽标文案、图标、配色都靠它区分「要你批准」和「目标卡住了」。
    let waitReason;
    if (pending)
        waitReason = pending.kind === 'permission' ? 'approval' : 'question';
    else if (goal?.goal?.phase === 'paused')
        waitReason = 'goal-paused';
    else if (goal?.goal?.phase === 'blocked')
        waitReason = 'goal-blocked';
    else if (exhausted && !row.running && !queued)
        waitReason = 'goal-limit';
    else if (stuckQueue)
        waitReason = 'queued';
    // 用户按了停止：回合正常收尾（completed/failed）与「被打断」在快照里必须能分开。
    const interrupted = !runningNow && !starting && !goalStarting && (row.ending?.kind === 'aborted' || row.ending?.kind === 'interrupted');
    // 失败回合被宿主折叠成「空提示可重跑」的 seq；error 事件不一定会留下来，所以它是独立信号。
    const continuable = !runningNow && !starting && !goalStarting && typeof row.values.conversationContinuation === 'number';
    // 回合/步骤/在跑的工具都来自日志尾页（`readTail`），累计输出来自可见的 tokenUsage。
    const tail = row.tail ?? {};
    const outputTokens = Number(row.values.tokenUsage?.outputTokens);
    const progress = {
        ...(Number.isFinite(tail.turn) ? { turn: tail.turn } : {}),
        ...(Number.isFinite(tail.step) ? { step: tail.step } : {}),
        ...(tail.tool ? { tool: tail.tool } : {}),
        ...(Number.isFinite(outputTokens) && outputTokens > 0 ? { outputTokens } : {}),
    };
    const detail = interrupted ? '' : waiting
        ? stuckQueue ? 'Input queued' : text(goal?.goal?.blockedReason?.message) || (exhausted ? 'Goal round limit reached' : 'Goal paused')
        : queued ? 'Input queued' : goalStarting ? 'Goal in progress' : runningNow ? 'Working' : 'Turn finished';
    return { running: Boolean(runningNow || starting || goalStarting), waiting, pending, error: row.error, detail,
        waitReason, queued: queueCount, interrupted, progress, continuable,
        updatedAt: Math.max(row.updatedAt, time(goal?.updatedAt)) };
}
