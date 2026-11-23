/* 星图几何：把鲸标 SVG 路径按弧长采样成星点目标坐标。

   只在构建期（Host 拼启动页那一次）跑；浏览器拿到的是百分比坐标与内联变量，
   运行时零脚本。纯函数，没有 DOM / Node 依赖，可以直接单测。 */
const COMMAND = /^[a-zA-Z]$/;
const TOKEN = /[a-zA-Z]|-?(?:\d*\.\d+|\d+(?:\.\d*)?)(?:[eE][-+]?\d+)?/g;
/** 折线精度：0.4 用户单位在 380px 宽的标识里约 6px，远小于星点间距。 */
const FLATNESS = 0.4;
function same(a, b) {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}
function span(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
/**
 * 把 `d` 拆成绝对坐标的线段 / 三次贝塞尔序列。
 * 只认 M/L/H/V/C/S/Z（大小写均可）：鲸标路径只用这些，遇到别的命令宁可报错，
 * 也不要静默画错轮廓。
 */
function traceContours(d) {
    const list = d.match(TOKEN);
    if (list === null)
        throw new Error('mark path has no tokens');
    let index = 0;
    const read = () => {
        if (index >= list.length)
            throw new Error('mark path ended mid-command');
        const raw = list[index];
        index += 1;
        const value = Number(raw);
        if (!Number.isFinite(value))
            throw new Error(`mark path has a bad number: ${raw}`);
        return value;
    };
    const contours = [];
    let segments = [];
    let closed = false;
    let command = '';
    let cursor = { x: 0, y: 0 };
    let begin = { x: 0, y: 0 };
    let control = null;
    const flush = () => {
        if (segments.length > 0)
            contours.push({ segments, closed });
        segments = [];
        closed = false;
    };
    while (index < list.length) {
        if (COMMAND.test(list[index])) {
            command = list[index];
            index += 1;
        }
        else if (command === '') {
            throw new Error(`mark path has a stray token: ${list[index]}`);
        }
        const relative = command === command.toLowerCase();
        const point = (x, y) => (relative ? { x: cursor.x + x, y: cursor.y + y } : { x, y });
        switch (command.toUpperCase()) {
            case 'M': {
                const start = point(read(), read());
                flush();
                cursor = start;
                begin = start;
                command = relative ? 'l' : 'L';
                control = null;
                break;
            }
            case 'L': {
                const to = point(read(), read());
                segments.push({ kind: 'line', from: cursor, to });
                cursor = to;
                control = null;
                break;
            }
            case 'H': {
                const to = { x: relative ? cursor.x + read() : read(), y: cursor.y };
                segments.push({ kind: 'line', from: cursor, to });
                cursor = to;
                control = null;
                break;
            }
            case 'V': {
                const to = { x: cursor.x, y: relative ? cursor.y + read() : read() };
                segments.push({ kind: 'line', from: cursor, to });
                cursor = to;
                control = null;
                break;
            }
            case 'C': {
                const c1 = point(read(), read());
                const c2 = point(read(), read());
                const to = point(read(), read());
                segments.push({ kind: 'cubic', from: cursor, c1, c2, to });
                cursor = to;
                control = c2;
                break;
            }
            case 'S': {
                // 平滑三次：第一个控制点是上一段控制点关于当前点的镜像。
                const c1 = control === null
                    ? cursor
                    : { x: cursor.x * 2 - control.x, y: cursor.y * 2 - control.y };
                const c2 = point(read(), read());
                const to = point(read(), read());
                segments.push({ kind: 'cubic', from: cursor, c1, c2, to });
                cursor = to;
                control = c2;
                break;
            }
            case 'Z': {
                if (segments.length > 0 && !same(cursor, begin)) {
                    segments.push({ kind: 'line', from: cursor, to: begin });
                }
                closed = true;
                cursor = begin;
                control = null;
                flush();
                command = '';
                break;
            }
            default:
                throw new Error(`mark path uses an unsupported command: ${command}`);
        }
    }
    flush();
    return contours;
}
/** 逐段细分（线段一段，曲线按控制多边形长度自适应），同时记下累计弧长。 */
function flatten(contour) {
    const first = contour.segments[0].from;
    const points = [{ x: first.x, y: first.y }];
    const marks = [0];
    const push = (to) => {
        const last = points[points.length - 1];
        marks.push(marks[marks.length - 1] + span(last, to));
        points.push({ x: to.x, y: to.y });
    };
    for (const segment of contour.segments) {
        if (segment.kind === 'line') {
            push(segment.to);
            continue;
        }
        const { from, c1, c2, to } = segment;
        const hull = span(from, c1) + span(c1, c2) + span(c2, to);
        const steps = Math.max(6, Math.min(72, Math.ceil(hull / FLATNESS)));
        for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            const u = 1 - t;
            push({
                x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
                y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
            });
        }
    }
    return { points, marks, length: marks[marks.length - 1] };
}
/** 折线上距起点 `at` 弧长处的坐标（闭合轮廓按长度取模）。 */
function pointAt(trace, at) {
    const target = trace.length === 0 ? 0 : ((at % trace.length) + trace.length) % trace.length;
    let low = 0;
    let high = trace.marks.length - 1;
    while (low < high - 1) {
        const middle = (low + high) >> 1;
        if (trace.marks[middle] <= target)
            low = middle;
        else
            high = middle;
    }
    const start = trace.marks[low];
    const end = trace.marks[high];
    const ratio = end - start < 1e-9 ? 0 : (target - start) / (end - start);
    const a = trace.points[low];
    const b = trace.points[high];
    return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}
/** 按弧长占比分配条数，每条轮廓至少 `minimum` 个，再补齐 / 削减到恰好 `count`。 */
function allocate(lengths, count, minimum) {
    const total = lengths.reduce((sum, value) => sum + value, 0);
    const shares = lengths.map((length) => Math.max(minimum, Math.round((length / total) * count)));
    let drift = count - shares.reduce((sum, value) => sum + value, 0);
    // 余数总是往最长的轮廓上加减，保证短细节（眼睛）不被削掉。
    const order = lengths.map((_, position) => position).sort((a, b) => lengths[b] - lengths[a]);
    for (let guard = 0; drift !== 0 && guard < count * 4; guard += 1) {
        const slot = order[guard % order.length];
        if (drift > 0) {
            shares[slot] += 1;
            drift -= 1;
        }
        else if (shares[slot] > minimum) {
            shares[slot] -= 1;
            drift += 1;
        }
    }
    return shares;
}
/**
 * 沿 `d` 的轮廓按弧长均匀取 `count` 个星点，返回 viewBox 坐标。
 * 每颗星在均分位置上带 ±21% 间距的抖动、每条轮廓有随机相位，避免看起来像
 * 一条机械的虚线；`random` 由调用方注入，同一 seed 必得同一张星图。
 */
export function sampleMarkOutline(d, count, random) {
    const traces = traceContours(d).map(flatten).filter((trace) => trace.length > 1e-6);
    if (traces.length === 0 || count <= 0)
        return [];
    const shares = allocate(traces.map((trace) => trace.length), count, 3);
    const points = [];
    traces.forEach((trace, position) => {
        const n = shares[position];
        const spacing = trace.length / n;
        const phase = random() * spacing;
        for (let index = 0; index < n; index += 1) {
            const jitter = (random() - 0.5) * spacing * 0.42;
            points.push(pointAt(trace, phase + index * spacing + jitter));
        }
    });
    return points;
}
