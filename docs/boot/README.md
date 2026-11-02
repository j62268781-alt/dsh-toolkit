# 开机动画 · 设计稿与演示

这个目录**不是插件**，是 `dsh-shell-kit` 的开机动画设计稿与可交互演示。
真正的实现只有三个文件，在插件根目录的 `host/` 下：

- `host/boot.css` —— 动画样式（进 `<head>`，首屏前生效）
- `host/boot.html` —— 动画结构（内联鲸鱼 SVG，紧随 `<body>`）
- `host/boot.js` —— 计时、挂载检测、淡出

由 `index.js` 通过 `webserver/index-inject` 注入，细节见
[boot-design.md](boot-design.md) 与 [../../README.md](../../README.md) 的「三·五」节。

## 演示

| 文件 | 内容 |
| --- | --- |
| `demo-boot.html` | **当前实现的镜像**（A5「留白」）：描线 → 填色 → 字标 → 淡出。可切浅/深色、拖时间轴逐帧停看（`window.__boot.at(ms)` / `.play()` / `.pause()`） |
| `demo.html` | 早期「鲸鱼出海」草稿（跃出 → 扎回海里） |
| `demo-morph.html` | 早期「鲸鱼跃出 → 收成 logo」草稿 |
| `frames/` | 上面几版的截帧 |

`demo-boot.html` 是**生成物**：`node scripts/build-boot-demo.mjs` 会把真的
`host/boot.css` + `host/boot.html` 内联进来，时间轴常量也从 `host/boot.js` 里读
（`MIN_SHOW` / `FADE`）。所以改完实现跑一下脚本，演示页不会漂移。

打开方式（任意静态服务器，别用 file://，否则相对资源可能被拦）：

```bash
cd /Users/joeson/Documents/dsh-plugins/dsh-shell-kit
python3 -m http.server 8137
# → http://127.0.0.1:8137/docs/boot/demo-boot.html
```
