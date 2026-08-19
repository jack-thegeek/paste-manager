# Paste Manager 粘贴板管理

Electron 剪贴板管理器：托盘常驻 + `Win+V` 唤出，支持文本与图片，历史记录、置顶、分类筛选、黑白主题。

## 功能

- **唤出**：按 `Win+V` 唤出粘贴板（也可点托盘图标）
- **复制/粘贴**：点击记录=复制，双击或 `Enter`=粘贴到当前输入框
- **置顶**：悬停 `★` 按钮或按 `P` 置顶，置顶项显示在独立「置顶」标签
- **筛选**：全部 / 文本 / 图片 / 置顶 标签 + 关键词搜索（`/` 聚焦搜索框）
- **主题**：暗色 / 亮色（☀ 按钮切换，自动记住选择，默认亮色）
- **拖动**：按住顶部标题栏空白处可移动窗口，位置自动记忆（`window-state.json`）
- **历史上限**：300 条，置顶项不会被自动淘汰

## 快捷键

| 按键 | 作用 |
|---|---|
| `Win+V` | 唤出粘贴板 |
| `Esc` | 关闭窗口 |
| `↑` / `↓` | 选择记录 |
| `Enter` | 粘贴选中项 |
| `Del` / `Backspace` | 删除选中项（搜索框聚焦时不生效） |
| `P` | 置顶 / 取消置顶（搜索框聚焦时不生效） |
| `Ctrl+C` | 复制选中项 |
| `/` | 聚焦搜索框 |
| 单击 / 双击 | 复制 / 粘贴 |

## 开发运行

```bash
pnpm install
pnpm start
```

## 打包（Linux 单文件 AppImage）

```bash
pnpm run dist
```

产物：`dist/Paste Manager-<version>.AppImage`（单个可执行文件，双击或命令行直接运行）。

### 打包经验 / 注意事项

1. **pnpm 11 构建脚本白名单**：若 `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS ... exit 1`，需在 `pnpm-workspace.yaml` 配置：
   ```yaml
   allowBuilds:
     better-sqlite3: true
     electron: true
   ignoredBuiltDependencies:
     - electron-winstaller
   ```
   （`electron-winstaller` 仅 Windows 打包用，Linux 显式忽略；`better-sqlite3`、`electron` 必须允许构建）

2. **原生模块 ABI 匹配**：`pnpm install` 会重跑 better-sqlite3 的 prebuild 脚本，可能覆盖为 Node ABI（127），导致 Electron 加载 SIGSEGV / `NODE_MODULE_VERSION` 报错。修复：
   ```bash
   pnpm exec electron-rebuild -f -w better-sqlite3 -v 31.0.0
   ```
   已在 `package.json` 配置 `postinstall: electron-builder install-app-deps`，后续 `pnpm install` 会自动重编，一般无需手动。

3. **图标**：打包图标为 `build/icon.png`（256×256 PNG，由脚本绘制，无资源文件）。缺失时 electron-builder 会用 Electron 默认图标。

4. **无头/容器环境测试**：无 GPU 桌面环境运行 AppImage 需 `--no-sandbox`，并可能出现 GPU/zygote 报错噪音，属于环境限制而非应用问题。

5. **electron-builder 首次运行会联网下载** Electron 与 AppImage 工具链（appimagetool、7zip），需保持网络可用。

## 数据存储

- **历史记录**：SQLite 数据库 `~/.config/Paste Manager/paste.db`
  （文本存 TEXT，图片存 **BLOB 二进制（PNG）**；WAL 模式，实时写入）
- **主题偏好**：`~/.config/Paste Manager/theme.json`

## 注意事项

1. **better-sqlite3 需针对 Electron 重编译**：依赖是原生模块，npm/pnpm 默认安装的二进制匹配 Node 而非 Electron。重装 `node_modules` 后必须执行：
   ```bash
   pnpm exec electron-rebuild -f -w better-sqlite3 -v 31.0.0
   ```
   否则启动报 `NODE_MODULE_VERSION` 不匹配 / SIGSEGV。当前 Electron 版本需 ABI 125。
2. **Windows 上 `Win+V` 冲突**：Windows 系统将 `Win+V` 绑定为「剪贴板历史」，两者会抢响应，该场景下唤出键可能失效或被系统弹窗拦截。Linux 无此问题。
3. **Linux 托盘交互**：点击系统图标弹出菜单（打开 / 清空历史 / 退出），菜单由 `Menu.buildFromTemplate` 构建。部分 GNOME 托盘扩展可能不触发左键 `click` 事件。
4. **图片存 BLOB**：图片以 PNG 二进制存入 `blob` 列（不再用 base64 文本），读取时转为 dataURL 供渲染；历史自动淘汰时，最先淘汰最旧的未置顶记录。
5. **重复内容去重**：相同文本/图片在历史中仅保留一条，重复复制时自动置顶到第一位；去重会保留该项的置顶状态。

## 平台支持

- 粘贴模拟：Linux 依赖 `xdotool`（`sudo apt install xdotool`）
- Windows / macOS 使用各自系统命令，无需额外依赖
