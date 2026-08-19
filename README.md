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

## 数据存储

- **历史记录**：SQLite 数据库 `~/.config/Paste Manager/paste.db`
  （文本存原始字符串，图片存 base64 dataURL；WAL 模式，实时写入）
- **主题偏好**：`~/.config/Paste Manager/theme.json`
- **旧版数据**：首次启动时自动从 `history.json` 一次性迁移到 SQLite，迁移后该文件不再使用（保留作备份）

## 注意事项

1. **better-sqlite3 需针对 Electron 重编译**：依赖是原生模块，npm/pnpm 默认安装的二进制匹配 Node 而非 Electron。重装 `node_modules` 后必须执行：
   ```bash
   pnpm exec electron-rebuild -f -w better-sqlite3 -v 31.0.0
   ```
   否则启动报 `NODE_MODULE_VERSION` 不匹配 / SIGSEGV。当前 Electron 版本需 ABI 125。
2. **Windows 上 `Win+V` 冲突**：Windows 系统将 `Win+V` 绑定为「剪贴板历史」，两者会抢响应，该场景下唤出键可能失效或被系统弹窗拦截。Linux 无此问题。
3. **Linux 托盘交互**：点击系统图标弹出菜单（打开 / 清空历史 / 退出），菜单由 `Menu.buildFromTemplate` 构建。部分 GNOME 托盘扩展可能不触发左键 `click` 事件。
4. **图片以 base64 存储**：图片 dataURL 会显著增大数据库体积；历史自动淘汰时，最先淘汰最旧的未置顶记录。
5. **重复内容去重**：相同文本/图片在历史中仅保留一条，重复复制时自动置顶到第一位；去重会保留该项的置顶状态。

## 平台支持

- 粘贴模拟：Linux 依赖 `xdotool`（`sudo apt install xdotool`）
- Windows / macOS 使用各自系统命令，无需额外依赖
