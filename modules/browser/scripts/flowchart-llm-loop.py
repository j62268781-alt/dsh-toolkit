# -*- coding: utf-8 -*-
"""v2：上游 LLM ↔ browser_run 内层循环 流程图（Pillow，微软雅黑）。"""
import math
import re
import sys
from PIL import Image, ImageDraw, ImageFont

REG = "C:\\Windows\\Fonts\\msyh.ttc"
BOLD = "C:\\Windows\\Fonts\\msyhbd.ttc"

C = {
    "llm":     ("#E8F0FE", "#1A56B0", "#0F2F63"),
    "outer":   ("#E6F4EA", "#1E8E3E", "#0E4D22"),
    "observe": ("#E7F1FF", "#2B6CB0", "#123F66"),
    "gate":    ("#FFF4E0", "#C87B12", "#7A4708"),
    "judge":   ("#F1E8FE", "#7B3FF2", "#3F1D80"),
    "act":     ("#E0F7F4", "#0F8B7E", "#0A4A44"),
    "exit":    ("#FDE8E8", "#D93025", "#7A1B14"),
    "note":    ("#F3F4F6", "#9AA0A6", "#3C4043"),
}

W = 1980
MARGIN = 46
TOP = 168
HEAD = 62

# x 轴：四列 + 三条通道
LX, LW = MARGIN, 280
MX, MW = 380, 336
AX, AW = 776, 600
BUS = 1402           # 出口总线
BX, BW = 1452, 440
RIGHT_CH = 1916      # 返回通道（B 列右侧）
GUT_LM = 356         # L / M 之间的竖直通道


def fnt(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REG, size)


TOKEN_RE = re.compile(r"[A-Za-z0-9_@.\-/#:+=≥≤<>()\[\]{}|~%$*]+|\s+|.")


def wrap(text, f, maxw, d):
    out, cur = "", ""
    for tk in TOKEN_RE.findall(text):
        cand = cur + tk
        if cur and d.textlength(cand, font=f) > maxw:
            if tk.strip() == "":
                out += cur + "\n"
                cur = ""
            else:
                out += cur + "\n"
                cur = tk
        else:
            cur = cand
    out += cur
    return [ln for ln in out.split("\n")]


class Doc:
    def __init__(self):
        self.boxes = {}
        self.order = []
        p = ImageDraw.Draw(Image.new("RGB", (8, 8)))
        self.measure = p

    def add(self, bid, x, y, w, title, body, kind, ts=21, bs=17.5):
        fill, stroke, ink = C[kind]
        tf, bf = fnt(ts, True), fnt(bs)
        inner = w - 34
        tl = wrap(title, tf, inner, self.measure)
        lh = int(bs * 1.52)
        bl = []
        for b in body:
            bl += wrap(b, bf, inner, self.measure)
        for ln in tl + bl:                      # 溢出保护：绝不让文字出框
            assert self.measure.textlength(ln, font=tf if ln in tl else bf) <= inner + 1, (bid, ln)
        h = 12 + len(tl) * int(ts * 1.42) + 6 + len(bl) * lh + 14
        b = dict(id=bid, x=x, y=y, w=w, h=h, tl=tl, bl=bl, kind=kind, ts=ts, bs=bs, lh=lh)
        self.boxes[bid] = b
        self.order.append(b)
        return b

    def bottom(self):
        return max(b["y"] + b["h"] for b in self.order)


def arrow(d, pts, color="#6B7280", width=3, head=13):
    for i in range(len(pts) - 1):
        d.line([pts[i], pts[i + 1]], fill=color, width=width)
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    a = math.atan2(y2 - y1, x2 - x1)
    for off in (1, -1):
        d.line([(x2, y2), (x2 + head * math.cos(a + off * 2.55),
                           y2 + head * math.sin(a + off * 2.55))], fill=color, width=width)


def tag(d, x, y, text, color="#6B7280", size=15):
    f = fnt(size)
    w = d.textlength(text, font=f)
    d.rectangle([x - 4, y - 2, x + w + 4, y + size + 4], fill="#FFFFFF")
    d.text((x, y), text, font=f, fill=color)


def build():
    doc = Doc()
    p = ImageDraw.Draw(Image.new("RGB", (8, 8)))

    # ── 标题
    ttl = "上游 LLM（主模型）→ browser_run 内层循环 → 交回上游：一次工具调用里到底发生了什么"
    sub = ("依据本仓库真实实现：src/index.ts（工具面 / 注册）· src/task/loop.ts（runTask 有界循环）· "
           "judge.ts（判断层提问）· actions.ts（动作执行）· types.ts（阈值）；底部附真机 trace")
    img0 = Image.new("RGB", (W, 4000), "#FFFFFF")
    d = ImageDraw.Draw(img0)
    d.text((MARGIN, 30), ttl, font=fnt(33, True), fill="#111111")
    d.text((MARGIN, 80), sub, font=fnt(17), fill="#5F6368")
    d.line([(MARGIN, 124), (W - MARGIN, 124)], fill="#DADCE0", width=2)

    def head(x, w, t, s, kind):
        _, stroke, _ = C[kind]
        d.rounded_rectangle([x, TOP, x + w, TOP + HEAD], radius=10, fill=stroke)
        d.text((x + 14, TOP + 8), t, font=fnt(20, True), fill="#FFFFFF")
        d.text((x + 14, TOP + 35), s, font=fnt(14), fill="#FFFFFF")

    head(LX, LW, "① 用户 + 上游 LLM", "agent 循环：1 round = 1 次模型调用", "llm")
    head(MX, MW, "② 外层：一次工具调用", "插件代码 + 配置，不花模型的钱", "outer")
    head(AX, AW, "③ 内层：runTask 有界循环", "for step in 1..16：观察→门控→判断→执行 1 个动作", "gate")
    head(BX, BW, "④ 出口：停 / 交回", "只交现场，不替上游做决定", "exit")

    y = TOP + HEAD + 24

    # ── ① 用户 / LLM
    b = doc.add("L1", LX, y, LW, "你的一句话需求", [
        '例：「登录 saucedemo，把 Backpack 加进购物车」',
    ], "llm")
    y = b["y"] + b["h"] + 24
    b = doc.add("L2", LX, y, LW, "主模型产出一次 tool call", [
        "读完工具描述（能力边界 / 页面是不可信数据）后给出：",
        "goal · inputs（要填的值，模型自己决定）· subgoals · maxSteps",
        "整段对话里，主模型只消耗这 1 个 round",
    ], "llm")
    L2 = b
    y = b["y"] + b["h"] + 30
    b = doc.add("L3", LX, y, LW, "宿主把结果塞回对话", [
        "tool_result = 一段 JSON：status / steps / trace / usage / timings",
        "交回状态还带 candidates(@ref) 与 pageText",
    ], "llm")
    L3 = b
    y = b["y"] + b["h"] + 24
    b = doc.add("L4", LX, y, LW, "主模型下一轮：校验，而不是采信", [
        "按 next 提示用 browser_read / browser_snapshot 独立看结果",
        "需要断言身份时用 expectUrl / expectName",
        "内层只说「推到目标附近」，结束语永远是 needs_verification",
    ], "llm")
    y = b["y"] + b["h"] + 24
    b = doc.add("L5", LX, y, LW, "然后二选一", [
        "对 → 回答你；",
        "不对 → 用返回的 candidates 直接 browser_act 接管一步，或再调一次 browser_run（= 又一个 round）",
    ], "llm")

    # ── ② 外层
    ym = L2["y"]
    b = doc.add("M1", MX, ym, MW, "工具入口 execute(args)", [
        "先取 ctx.judgment（dsh-judgment 提供的可选服务）",
        "取不到 → 立刻抛 judge-unavailable，文案说明去哪装",
        "apiVersion ≠ 1 → 显式降级报错，不假装能判断",
    ], "outer")
    ym = b["y"] + b["h"] + 20
    b = doc.add("M2", MX, ym, MW, "组装 deps（配置来自设置页）", [
        "browser：agent-browser CLI 命名会话（不劫持别人窗口）",
        "purpose=browser.action（换模型/换 key 只改设置）",
        "maxSteps 16 · goalThreshold 0.85 · stuckThreshold 0.85",
        "inputs（值由调用方给）· allowIrreversible（默认 false）",
    ], "outer")
    ym = b["y"] + b["h"] + 20
    b = doc.add("M3", MX, ym, MW, "给了 subgoals？→ runSubgoals", [
        "按顺序逐个跑 runTask，共享 maxSteps",
        "上一个子目标返回 needs_verification 才走下一个",
        "其它状态原样停下交回上游",
    ], "outer")
    ym = b["y"] + b["h"] + 20
    b = doc.add("M4", MX, ym, MW, "runTask(goal, deps)", [
        "= 右边这条内层循环",
        "一次调用里跑 N 步：N 次观察 + N 次小模型判断 + N 个动作",
        "主模型全程不参与（省 token 的关键）",
    ], "outer")
    M4 = b
    ym = b["y"] + b["h"] + 20
    b = doc.add("M6", MX, ym, MW, "return JSON.stringify(result)", [
        "一个工具结果 → 回到 L3，这个 round 结束",
        "计时/成本分类记账：snapshotMs / askMs / actMs / calls / tokens",
    ], "outer")
    M6 = b

    # ── ③ 内层主路径
    ya = TOP + HEAD + 24
    b = doc.add("A0", AX, ya, AW, "第 N 步开始（step = 1..maxSteps，默认 16）", [
        "先看 signal：被取消 → finish('budget','cancelled')",
    ], "gate")
    ya = b["y"] + b["h"] + 15
    b = doc.add("A1", AX, ya, AW, "① 观察页面（每步重取，永远新鲜）", [
        "页面内抽取 extract()：一次 eval 拿齐可见元素 + 角色 + 可访问名 + 状态（勾选 / 当前值 / 已有内容）+ "
        "所在行文本 + 正文/标题/URL（上限 300 个元素）",
        "目标点名的角色没抽到（shadow DOM / iframe）或一个都没抽到 → 退回无障碍整树快照",
        "上一步「交付了但没见效」→ sleep 40ms 再采一次；导航类动作再事件驱动 waitForPageShift（≤4s）",
        "顺手算出 last_change：新增 / 移除 / 状态变化 / 正文变化 / URL 变化",
    ], "observe")
    ya = b["y"] + b["h"] + 15
    b = doc.add("A2", AX, ya, AW, "② 确定性门控（在叫小模型之前，纯代码直接判）", [
        "JS 对话框挡路 → dialog accept/dismiss；页面在加载（loading… / Wait for it…）→ 等它变（最多 3 次）",
        "命中即停 needs_verification：URL 新增段命中目标词｜关闭控件点过且它消失了｜加购后出现 Remove｜"
        "目标点名的提交/排序表头/按键点过且页面已变｜Enter 后多了刚填的条目｜勾选·单选全部达成｜拖拽·悬停已生效｜"
        "密钥已填且表单翻页｜inputs 全部生效且目标没有后续动词",
    ], "gate")
    A2 = b
    ya = b["y"] + b["h"] + 15
    b = doc.add("A3", AX, ya, AW, "③ 候选整理（纯代码，不请示模型）", [
        "候选池 = 页面元素（click:* / input:*）+ 5 个固定控制项（滚动×2 / 返回 / 等待 / Enter）",
        "状态守卫：已处于目标状态的跳过；已按 inputs 填过的字段跳过（Enter 消费过就不再重填）",
        "按目标词面、所在行、主内容区、序号（first / #1）分层排序，预算 40；剔除已证明无效的；送判断层前截到 10",
        "一个可操作元素都没有 → 独立确认后 no_progress（或终态页 needs_verification）",
    ], "gate")
    ya = b["y"] + b["h"] + 15
    b = doc.add("A4", AX, ya, AW, "④ Jev 判断层：一个批次 ask（本步唯一动用模型的地方）", [
        "state：goal · url · snapshot(≤6000 字) · page_text · page_title · last_change · history(近 8 步) · wall_clock",
        "questions：action（choice：在候选里选唯一动作，全体选项概率和 = 1）｜goal_done｜stuck｜irreversible｜"
        "login｜page_error（有上一步变化时加 done_change；有上一步动作时加 target_match；多值时加 value 选 key）",
        "纪律：候选由代码枚举、判断只做排序；敏感字段值只显示 ●●●；分布不合法 → 缩候选重采 ≤3 次；"
        "页面只有一个输入框 → 免判断",
    ], "judge")
    A4 = b
    ya = b["y"] + b["h"] + 15
    b = doc.add("A5", AX, ya, AW, "⑤ 停止门（在动作之前判）", [
        "goal_done ≥ 0.85（多步目标收紧到 0.95）且没有待生效字段 → 独立再问一次 confirm（p ≥ 0.8 才停）→ needs_verification",
        "0.6 ≤ goal_done < 0.85 且 confirm ≥ 0.6 → likely_done（看起来完成，交回验证）",
        "login ≥ 0.75 且没给凭据 → needs_login｜page_error ≥ 0.8 → page_error｜stuck ≥ 0.85 → blocked",
        "有字段还没填进去 → goal_done 再高也不许结束，继续推进",
    ], "exit")
    A5 = b
    ya = b["y"] + b["h"] + 15
    b = doc.add("A6", AX, ya, AW, "⑥ 确定性改选（代码覆盖 Jev 的选择）", [
        "inputs 里还有字段没生效 → 先填它（这是最常走的分支）",
        "目标明确要加购某件 → 改选那个 Add to cart",
        "搜索 / 新建、刚打完字、页面没有提交按钮 → 改按 Enter",
        "目标点名唯一未满足的 checkbox/radio → 改选它；都满足了且有末尾子句按钮 → 改选该按钮",
    ], "gate")
    ya = b["y"] + b["h"] + 15
    b = doc.add("A7", AX, ya, AW, "⑦ 风险门 / 弃权", [
        "没有 action 或 abstain → blocked（不猜）；选中不存在的候选 → judge_error（不「修复」答案）",
        "置信 < 0.45 且前两名差 < 0.15 → ambiguous，附前 3 名候选交回",
        "不可逆 p ≥ 0.7 且没给 allowIrreversible → needs_confirmation（下单 / 支付 / 发送 / 删除先问人）",
        "选中输入框但没有任何值来源 → input_required（值只能宿主给，绝不猜文字）",
    ], "exit")
    A7 = b
    ya = b["y"] + b["h"] + 15
    b = doc.add("A8", AX, ya, AW, "⑧ 执行 1 个动作（每步只一个）", [
        "click / fill / select / check / uncheck / hover / drag / press / scroll / back / wait",
        "原生 select → select；checkbox·radio·switch → check/uncheck；其余 → fill（值都来自 inputs）",
        "a / button 走 jsClick 兜底（先 scrollintoview）；fill 后读回 value 校验，两次不一致 → no_progress",
        "ref 失效连续 3 次 → 先独立确认，过则 needs_verification、否则 no_progress；动作失败连续 2 次 → action_error",
    ], "act")
    ya = b["y"] + b["h"] + 15
    b = doc.add("A9", AX, ya, AW, "⑨ 记账 + 见效判定 → 回到 ①", [
        "steps 追加（origin / digest / action / executed / reason / 概率）；trace 写人类可读的「第 N 步：…」",
        "delivered 记下这一步点过的控件与当时快照；下一步语义没变 → 标 useless：次优候选 p ≥ 0.25 才换路（≤2 次），"
        "否则立即 no_progress（不做 p=0.06 的盲点）",
        "多字段表单同一步内顺手批填，省掉 N-1 轮抽取与判断",
    ], "act")
    A9 = b
    ya = b["y"] + b["h"] + 15
    b = doc.add("A10", AX, ya, AW, "跑满 maxSteps 还没停", [
        "结束前再独立 confirm 一次：过 → needs_verification；不过 → finish('budget')",
    ], "exit")
    A10 = b

    # ── ④ 出口列
    yb = TOP + HEAD + 24
    b = doc.add("B1", BX, yb, BW, "needs_verification（达标）", [
        "含义是「页面被推到目标状态」，不是「已完成」",
        "最终校验一律留给上游 LLM（39 任务真机基准 false-done = 0）",
    ], "exit")
    B1 = b
    yb = b["y"] + b["h"] + 18
    b = doc.add("B2", BX, yb, BW, "早停交回（不猜、不乱点）", [
        "likely_done · ambiguous · input_required · needs_confirmation · needs_login · no_progress · "
        "blocked · page_error · budget · judge_error · action_error",
        "每种状态都带一句 next 提示，告诉上游下一步怎么做",
    ], "exit")
    B2 = b
    yb = b["y"] + b["h"] + 18
    b = doc.add("B3", BX, yb, BW, "finish(status) 统一打包", [
        "status · reason · steps[] · trace[] · url · usage(calls/tokens/cost) · timings",
        "交回状态额外附：candidates 前 5（带 @ref，可直接 browser_act）· pageText 摘要(≤800) · next",
    ], "outer")
    B3 = b
    yb = b["y"] + b["h"] + 18
    b = doc.add("B4", BX, yb, BW, "为什么「交回」要带现场", [
        "省掉主模型补一次 browser_snapshot 的 round",
        "@ref 是身份绑定的句柄，接管只花 1 步",
        "干净早停 > 乱点：宁可停，也不拿不可信的候选去试",
    ], "note")
    B4 = b

    # ── 画
    def paint(img):
        d = ImageDraw.Draw(img)
        for b in doc.order:
            fill, stroke, ink = C[b["kind"]]
            d.rounded_rectangle([b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]],
                                radius=12, fill=fill, outline=stroke, width=2)
            tf, bf = fnt(b["ts"], True), fnt(b["bs"])
            ty = b["y"] + 11
            for ln in b["tl"]:
                d.text((b["x"] + 16, ty), ln, font=tf, fill=ink)
                ty += int(b["ts"] * 1.42)
            ty += 4
            for ln in b["bl"]:
                d.text((b["x"] + 16, ty), ln, font=bf, fill="#23272E")
                ty += b["lh"]
        return d

    y_bottom = max(A10["y"] + A10["h"], B4["y"] + B4["h"]) + 34
    img = Image.new("RGB", (W, y_bottom + 420), "#FFFFFF")
    d = paint(img)

    # 标题/页头重画（paint 只能重画框，页头在另一张图，这里补上）
    d.text((MARGIN, 30), ttl, font=fnt(33, True), fill="#111111")
    d.text((MARGIN, 80), sub, font=fnt(17), fill="#5F6368")
    d.line([(MARGIN, 124), (W - MARGIN, 124)], fill="#DADCE0", width=2)
    for args in [
        (LX, LW, "① 用户 + 上游 LLM", "agent 循环：1 round = 1 次模型调用", "llm"),
        (MX, MW, "② 外层：一次工具调用", "插件代码 + 配置，不花模型的钱", "outer"),
        (AX, AW, "③ 内层：runTask 有界循环", "for step in 1..16：观察→门控→判断→执行 1 个动作", "gate"),
        (BX, BW, "④ 出口：停 / 交回", "只交现场，不替上游做决定", "exit"),
    ]:
        x, w, t, s, kind = args
        _, stroke, _ = C[kind]
        d.rounded_rectangle([x, TOP, x + w, TOP + HEAD], radius=10, fill=stroke)
        d.text((x + 14, TOP + 8), t, font=fnt(20, True), fill="#FFFFFF")
        d.text((x + 14, TOP + 35), s, font=fnt(14), fill="#FFFFFF")

    # ① 列内箭头
    for a, b2 in [("L1", "L2"), ("L2", "L3"), ("L3", "L4"), ("L4", "L5")]:
        p, q = doc.boxes[a], doc.boxes[b2]
        arrow(d, [(p["x"] + p["w"] // 2, p["y"] + p["h"]), (q["x"] + q["w"] // 2, q["y"])], "#1A56B0")

    # L2 → M1（同高，直连）
    M1 = doc.boxes["M1"]
    arrow(d, [(LX + LW, L2["y"] + L2["h"] // 2), (MX, M1["y"] + M1["h"] // 2)], "#1A56B0", 3, 14)
    # ② 列内箭头
    for a, b2 in [("M1", "M2"), ("M2", "M3"), ("M3", "M4")]:
        p, q = doc.boxes[a], doc.boxes[b2]
        arrow(d, [(p["x"] + p["w"] // 2, p["y"] + p["h"]), (q["x"] + q["w"] // 2, q["y"])], "#1E8E3E")
    # M4 → A0
    A0 = doc.boxes["A0"]
    arrow(d, [(MX + MW, M4["y"] + 34), (AX, A0["y"] + A0["h"] // 2)], "#1E8E3E", 3, 14)

    # ③ 主路径
    chain = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]
    for a, b2 in zip(chain, chain[1:]):
        p, q = doc.boxes[a], doc.boxes[b2]
        arrow(d, [(p["x"] + p["w"] // 2, p["y"] + p["h"]), (q["x"] + q["w"] // 2, q["y"])], "#6B7280")

    # 回环：A9 → A0，走 A 列左侧通道
    p, q = doc.boxes["A9"], doc.boxes["A0"]
    rail = AX - 18
    arrow(d, [(p["x"], p["y"] + p["h"] // 2), (rail, p["y"] + p["h"] // 2),
              (rail, q["y"] + q["h"] // 2), (q["x"], q["y"] + q["h"] // 2)], "#0F8B7E", 3, 15)
    tag(d, rail - 44, q["y"] + q["h"] // 2 + 8, "下一步", "#0F8B7E", 16)

    # 出口总线：A2 / A5 / A7 / A9 / A10 → B1 / B2
    for a in ("A2", "A5", "A7", "A9", "A10"):
        p = doc.boxes[a]
        arrow(d, [(p["x"] + p["w"], p["y"] + 26), (BUS, p["y"] + 26)], "#D93025", 2, 11)
    bus_top = min(B1["y"] + B1["h"] - 16, doc.boxes["A2"]["y"] + 26)
    bus_bot = doc.boxes["A10"]["y"] + 26
    d.line([(BUS, bus_top), (BUS, bus_bot)], fill="#D93025", width=3)
    tag(d, BUS + 8, B2["y"] - 24, "停", "#D93025", 15)
    # 总线 → B1 / B2
    arrow(d, [(BUS, B1["y"] + B1["h"] - 16), (BX, B1["y"] + B1["h"] - 16)], "#D93025", 3, 13)
    arrow(d, [(BUS, B2["y"] + B2["h"] // 2), (BX, B2["y"] + B2["h"] // 2)], "#D93025", 3, 13)
    # B 列内箭头
    for a, b2 in [("B1", "B3"), ("B2", "B3"), ("B3", "B4")]:
        p, q = doc.boxes[a], doc.boxes[b2]
        arrow(d, [(p["x"] + p["w"] // 2, p["y"] + p["h"]), (q["x"] + q["w"] // 2, q["y"])], "#D93025")

    # 返回上游：B3 → 右侧通道 → 底部 → M6
    p = doc.boxes["B3"]
    ych = y_bottom
    arrow(d, [(BX + BW, p["y"] + p["h"] // 2), (RIGHT_CH, p["y"] + p["h"] // 2),
              (RIGHT_CH, ych), (M6["x"] + M6["w"] // 2, ych),
              (M6["x"] + M6["w"] // 2, M6["y"] + M6["h"])], "#1A56B0", 3, 14)
    tag(d, MARGIN + 120, ych - 30, "结果作为 tool_result 交回上游 LLM（这个 round 结束）", "#1A56B0", 16)

    # M6 → L3（左侧通道竖直）
    arrow(d, [(M6["x"], M6["y"] + M6["h"] // 2), (GUT_LM, M6["y"] + M6["h"] // 2),
              (GUT_LM, L3["y"] + L3["h"] // 2), (L3["x"] + L3["w"], L3["y"] + L3["h"] // 2)], "#1A56B0", 3, 14)

    # ── 底部：第一轮真实 trace
    bx0 = MARGIN
    by0 = y_bottom + 46
    d.rounded_rectangle([bx0, by0, W - MARGIN, by0 + 330], radius=12, fill="#FFF9E6",
                        outline="#C87B12", width=2)
    d.text((bx0 + 20, by0 + 12),
           "「第一轮」实际做了什么 —— 真机 trace（goal=「Log in with credentials」，docs/probes/r8-saucedemo-trace.json）",
           font=fnt(22, True), fill="#7A4708")
    rows = [
        ("第 1 步：页面内抽取 3 个元素（跳过被遮挡 0 个）→ 7 个候选", "① 观察：一次 extract 拿齐元素+状态+正文，这一步没有模型参与"),
        ("第 1 步：goal_done=0.56 stuck=0.04 候选=7 置信=0.86", "④ 本步唯一一次小模型调用：7 个问题一个批次问完"),
        ("第 1 步：还有没生效的字段「Username」→ 先填它", "⑥ 确定性改选：Jev 选的是点击，代码按 inputs 改成先填字段"),
        ("第 1 步：按调用方的值填 textbox「Username」= standard_user ✓", "⑧ 执行 1 个动作：值是主模型给的，插件不猜文字"),
        ("第 4 步：密钥字段已填、页面已无输入框（…/inventory.html）→ 表单已提交，交回宿主校验", "② 确定性收尾 → needs_verification，主模型去独立验证"),
    ]
    ty = by0 + 50
    for left, right in rows:
        d.text((bx0 + 20, ty), left, font=fnt(16.5), fill="#23272E")
        d.text((bx0 + 1000, ty), "← " + right, font=fnt(16), fill="#7A4708")
        ty += 30
    ty += 8
    note = ("成本量级（同一 trace 里「加进购物车」那个子目标）：calls=2、tokens=2656、≈$0.000112、1250ms / 2 步；"
            "而主模型侧只花了 1 个 round。也就是说：N 步操作 = 1 次工具调用，中间 N 次观察与 N 次小模型判断都在插件里跑完，"
            "主模型的上下文不被页面噪声撑爆 —— 这是整套设计的主要目的。")
    for ln in wrap(note, fnt(16.5), W - 2 * MARGIN - 40, d):
        d.text((bx0 + 20, ty), ln, font=fnt(16.5), fill="#7A4708")
        ty += 28

    return img.crop((0, 0, W, ty + 34))


out = sys.argv[1] if len(sys.argv) > 1 else "docs/flowchart-llm-browser-run-loop.png"
im = build()
im.save(out)
print(out, im.size)
