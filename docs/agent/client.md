# Client 侧：CSS 注入与主题护栏（AGENTS.md §8 细则）

> 从 AGENTS.md 拆出，内容不变；改这类约定时先改这里，再看 AGENTS.md 的摘要要不要同步。

## 8. CSS：注入方式与主题护栏

判定规则只有一条 —— **样式要覆盖到的节点是否在面板 React 子树之外**：

| 场景 | 方式 | 现有模块 |
| --- | --- | --- |
| 面板外还有 DOM：`shell.overlay` 弹层、侧栏菜单项 | `apply()` 里 `installStylesheet` | theme、archived、notification |
| 只服务 `settings.section` 面板自身 | 组件内 `<style>{CSS}</style>` | judgment、mobile、skills-mcp |
| 同上但历史上用全局注入 | 保留，别再新增 | boot、pet |

- 全局注入点必须留一行注释说明「为什么不能挪进面板」（宿主用 `createPortal` 渲染在面板子树外）。
- `installStylesheet` 写 `data-plugin` / `data-plugin-css`，正是宿主的 `claimStyles()` / `removeOwnedStyles()`
  回收约定；改它之前先读宿主那两段实现。
- 模块的 `surfaces/*/style.css` 与 `components/*/style.css` 由 `index.ts` 用 `composeStyles` 拼成**一个**
  `<style>`，不要每个 surface 各插一个。

**主题 CSS 护栏**（`src/modules/theme/client/styles/` 的 `tokens.css` / `layout.css` / `sidebar.css` / `rightbar.css`）：

1. 每条规则的每个选择器都必须以 `html[data-sk-palette="codex"]` 开头（有测试强制）；
2. 全局 `@keyframes` 只允许 `cx-` 前缀；
3. 选择器要带足够上下文 —— 宿主类名是 hash 变体，只能 `[class*="_xxx"]` 子串匹配，越宽越容易误伤
   （踩过：`_label` 规则把 tooltip 裁成 1×1）；
4. **画圆必须显式 `corner-shape: round`**：宿主注入 `@supports (corner-shape:superellipse(1.5))`，
   任何 `border-radius:50%` 都会被画成超椭圆。

---

