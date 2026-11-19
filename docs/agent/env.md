# 本机 DSH 环境与安装（AGENTS.md §12 的细则：随机器而变的部分都在这里）

> AGENTS.md §12 只讲「改完之后怎么生效」；`DSH_HOME` 路径、profile 名、安装命令、asar 反查
> 都依赖具体机器，所以只放这里，不进每会话注入的那一页。换机器时改这一篇即可。

## 本机 DSH 环境

- `DSH_HOME=D:\DeepSeekHarness-home`，profile 是桌面端 `desktop`。
- 本仓库以 `link:` 装进 profile：`dsh.profile.bundles` 加 `dsh-toolkit`，`dependencies` 加
  `"dsh-toolkit": "link:D:/项目/dsh-toolkit"`，然后在 profile 目录用桌面端自带 pnpm 安装：

  ```powershell
  $env:CI="true"
  node "D:\软件\deepseek\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install --no-frozen-lockfile
  ```

- **不要**用 `dsh plugin --profile desktop`：桌面端 profile 由桌面应用管理。
- 生效方式：只改 client → `pnpm build` 后按 **Ctrl+R**；改 host（含 `cordis.patch.yml`、`src/index.ts`）→
  **重启 DSH 桌面端**（bundles 只在进程启动时读一次）。重启会中断当前会话回合，由用户操作。
- 安装前备份 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`。
- 反查宿主实现：`D:\软件\deepseek\resources\app.asar` 用 `u32[4]=headerSize`、`base=8+headerSize` 解包。

---

