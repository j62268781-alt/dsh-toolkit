# 开机动画 · 设计稿与演示

这个目录保存启动动画的设计稿与演示。实际插件实现位于 [boot 模块](../../src/modules/boot/)：

- [boot.css](../../src/modules/boot/host/boot.css)：描摹、海面、飞跃、粒子和减少动态样式，首屏前注入。
- [boot.html](../../src/modules/boot/host/boot.html)：经典描摹的内联鲸鱼 SVG。
- [scene.js](../../src/modules/boot/host/scene.js)：选择场景、生成有限水花粒子，并输出共用的运行与预览结构。
- [boot.js](../../src/modules/boot/host/boot.js)：动画时长、宿主就绪检测、跳过、淡出和 10 秒失败兜底。
- [index.js](../../src/modules/boot/host/index.js)：通过 `webserver/index-inject` 注入场景。

## 三款动画

| 配置键 | 设置页名称 | 设计来源与效果 |
| --- | --- | --- |
| `draw` | 经典描摹 | [demo-boot.html](demo-boot.html)：描线 → 填色 → 字标；鲸标固定，不增加落定抖动 |
| `water` | 跃浪成标 | [demo-morph.html](demo-morph.html)：鲸鱼从海面跃出，沿原弧线收成 Logo，保留落定冲击、水花和三层海面 |
| `abyss` | 鲸跃归海 | [demo.html](demo.html)：鲸鱼沿原抛物线跃出再入水，保留起跳和两簇落水粒子、品牌字标与海面遮挡 |

既有配置键保持兼容。文档中的独立演示保留原始设计语言；设置页预览直接使用实际插件的场景与 CSS，不执行演示脚本，也不模拟宿主就绪。经典描摹的运行与预览均固定鲸标尺寸、文字字距和位置，点阵只淡入，不缩放；播放过程只改变描线进度和透明度，避免点阵重采样与文字重排带来的抖动。

每款动画自行决定展示时长：`draw` 2.4 秒、`water` 2.9 秒、`abyss` 4.5 秒，均按原速播放。设置页不再提供时长选项，旧 `durationMs` 配置会被忽略。动画播放完成且宿主已挂载后进入桌面；宿主尚未就绪时继续等待，保留 10 秒失败兜底。粒子在构建场景 HTML 时一次性生成，运行和沙箱预览一致；退出时随场景移除。允许跳过时可点击或按 Esc、空格、Enter 提前结束。

明暗设置和系统减少动态偏好均生效。减少动态时隐藏飞跃、水花及闪光，保留静态鲸标和字标。设计演示的重播、时间轴与模拟就绪仅用于独立查看，不参与真实应用启动。

设置页的开关沿用「通用设置」的轨道尺寸与状态色；「画面配色」是原生 `<select>`，与通知面板的「通知时机」「声音」下拉共用 [settings.css](../../src/client/styles/settings.css) 里按面板前缀裁剪的 `.boot-select` / `.ntf-select` 规则（`appearance:none` + 自绘 chevron、距右边缘 10px），所以两个面板的下拉尺寸、边框和箭头位置完全一致。
