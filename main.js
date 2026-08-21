const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, nativeImage, ipcMain, screen } = require('electron')

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const { exec } = require('child_process')

const MAX_ITEMS = 300
const POLL_MS = 400

let tray = null
let win = null
let db = null
let history = []
let currentPoll = { text: '', imageSig: '' }
let isQuitting = false
let winPos = null

/* ---------- PNG icon generation (draws a clipboard, no asset file needed) ---------- */

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crc32.table[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

function drawClipboardIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const inRounded = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const rx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
    const ry = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
    return Math.hypot(x - rx, y - ry) <= r
  }
  const set = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y, 12, 3, 19, 8, 2)) set(x, y, [150, 180, 240, 255])
      else if (inRounded(x, y, 5, 8, 26, 27, 3)) set(x, y, [74, 120, 227, 255])
    }
  }
  return encodePNG(size, size, px)
}

/* ---------- window ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: bgColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('blur', () => {
    if (win && win.isVisible()) win.hide()
  })
  win.on('moved', saveWindowState)
}

function getActiveWindowDIP() {
  return new Promise((resolve) => {
    exec('xdotool getactivewindow getwindowgeometry --shell', (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const m = /X=(-?\d+)\nY=(-?\d+)\nWIDTH=(\d+)\nHEIGHT=(\d+)/.exec(stdout)
      if (!m || +m[3] <= 0 || +m[4] <= 0) return resolve(null)
      const cx = +m[1] + +m[3] / 2
      const cy = +m[2] + +m[4] / 2
      const s = screen.getDisplayNearestPoint({ x: cx, y: cy }).scaleFactor || 1
      resolve({ x: +m[1] / s, y: +m[2] / s, width: +m[3] / s, height: +m[4] / s })
    })
  })
}

async function showWindow(atCursor = false) {
  if (!win) return
  const { width, height } = win.getBounds()
  if (atCursor) {
    // Prefer the focused window: place the panel near its bottom-center (the
    // caret/input area), since the physical mouse may sit far from where the
    // user is typing. Fall back to the mouse cursor when xdotool is unavailable.
    let wx = null
    let wy = null
    if (process.platform === 'linux') {
      const aw = await getActiveWindowDIP()
      if (aw) {
        const wa = screen.getDisplayNearestPoint({ x: aw.x + aw.width / 2, y: aw.y + aw.height / 2 }).workArea
        wx = aw.x + aw.width / 2 - width / 2
        wy = aw.y + aw.height - height - 12
        wx = Math.max(wa.x, Math.min(wx, wa.x + wa.width - width))
        wy = Math.max(wa.y, Math.min(wy, wa.y + wa.height - height))
      }
    }
    if (wx === null || wy === null) {
      const cursor = screen.getCursorScreenPoint()
      const disp = screen.getDisplayNearestPoint(cursor)
      const wa = disp.workArea
      let x = cursor.x + 12
      let y = cursor.y + 12
      if (x + width > wa.x + wa.width) x = cursor.x - width - 12
      if (y + height > wa.y + wa.height) y = cursor.y - height - 12
      wx = Math.max(wa.x, Math.min(x, wa.x + wa.width - width))
      wy = Math.max(wa.y, Math.min(y, wa.y + wa.height - height))
    }
    win.setPosition(Math.round(wx), Math.round(wy))
  } else if (winPos) {
    win.setPosition(Math.round(winPos.x), Math.round(winPos.y))
  } else {
    let x = null
    let y = null
    try {
      const tb = tray.getBounds()
      if (tb.width > 0 && tb.height > 0) {
        const disp = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y })
        const wa = disp.workArea
        x = wa.x + wa.width - width - 8
        y = tb.y + tb.height / 2 - height / 2
        y = Math.max(wa.y, Math.min(y, wa.y + wa.height - height))
      }
    } catch (e) { /* tray bounds unavailable, fall back below */ }
    if (x === null || y === null) {
      const cursor = screen.getCursorScreenPoint()
      const disp = screen.getDisplayNearestPoint(cursor)
      const wa = disp.workArea
      x = wa.x + wa.width - width - 8
      y = wa.y + 8
    }
    win.setPosition(Math.round(x), Math.round(y))
  }
  win.show()
  win.focus()
  win.webContents.send('history-updated', history)
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'window-state.json'), 'utf8')
    winPos = JSON.parse(raw)
  } catch (e) { winPos = null }
}

function saveWindowState() {
  if (!win) return
  const [x, y] = win.getPosition()
  winPos = { x, y }
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'window-state.json'), JSON.stringify(winPos)) } catch (e) { /* ignore */ }
}

/* ---------- history (SQLite) ---------- */

function clipText(text) {
  if (text.length > 2000) text = text.slice(0, 2000) + ' …'
  return text
}

const rowToItem = (r) => ({
  id: r.id,
  type: r.type,
  data: r.blob ? `data:image/png;base64,${r.blob.toString('base64')}` : r.data,
  preview: r.preview,
  ts: r.ts,
  pinned: !!r.pinned
})

function refreshHistory() {
  history = db.prepare('SELECT * FROM history ORDER BY id DESC').all().map(rowToItem)
}

function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'paste.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '',
      blob BLOB,
      preview TEXT NOT NULL DEFAULT '',
      ts INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    )
  `)
  try { db.exec('ALTER TABLE history ADD COLUMN blob BLOB') } catch (e) { /* column already exists */ }
  refreshHistory()
}

function addHistory(item) {
  if (item.type === 'text') {
    item.preview = clipText(item.data)
    const dup = db.prepare('SELECT pinned FROM history WHERE type = ? AND data = ? ORDER BY id DESC').get('text', item.data)
    const pinned = dup ? !!dup.pinned : false
    db.prepare('DELETE FROM history WHERE type = ? AND data = ?').run('text', item.data)
    db.prepare('INSERT INTO history (type, data, preview, ts, pinned, blob) VALUES (?, ?, ?, ?, ?, ?)')
      .run('text', item.data, item.preview, item.ts, pinned ? 1 : 0, null)
  } else if (item.type === 'image') {
    item.preview = '[图片]'
    item.data = `data:image/png;base64,${item.png.toString('base64')}`
    const dup = db.prepare('SELECT pinned FROM history WHERE type = ? AND blob = ? ORDER BY id DESC').get('image', item.png)
    const pinned = dup ? !!dup.pinned : false
    db.prepare('DELETE FROM history WHERE type = ? AND blob = ?').run('image', item.png)
    db.prepare('INSERT INTO history (type, data, preview, ts, pinned, blob) VALUES (?, ?, ?, ?, ?, ?)')
      .run('image', item.data, item.preview, item.ts, pinned ? 1 : 0, item.png)
  }
  trimHistory()
  refreshHistory()
  if (win && win.isVisible()) win.webContents.send('history-updated', history)
}

function trimHistory() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM history').get()
  if (c <= MAX_ITEMS) return
  db.prepare(`
    DELETE FROM history WHERE id IN (
      SELECT id FROM history WHERE pinned = 0 ORDER BY id ASC LIMIT ?
    )
  `).run(c - MAX_ITEMS)
}

function clearHistory() {
  db.prepare('DELETE FROM history WHERE pinned = 0').run()
  refreshHistory()
  currentPoll = captureCurrentClipboard()
}

function readTheme() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'theme.json'), 'utf8')
    return JSON.parse(raw) === 'light' ? 'light' : 'dark'
  } catch (e) { return 'light' }
}

function readStyle() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'style.json'), 'utf8')
    return JSON.parse(raw) === 'flat' ? 'flat' : 'glass'
  } catch (e) { return 'glass' }
}

function bgColor() {
  const flat = readStyle() === 'flat'
  if (flat) return readTheme() === 'light' ? '#f3faf8' : '#0f172a'
  return readTheme() === 'light' ? '#eef1ff' : '#0b1020'
}

/* ---------- clipboard polling ---------- */

function pollClipboard() {
  try {
    const text = clipboard.readText()
    if (text && text !== currentPoll.text) {
      currentPoll.text = text
      addHistory({ type: 'text', data: text, ts: Date.now() })
    }
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      const png = img.toPNG()
      if (png && png.length) {
        const sig = png.toString('base64')
        if (sig !== currentPoll.imageSig) {
          currentPoll.imageSig = sig
          addHistory({ type: 'image', png, ts: Date.now() })
        }
      }
    }
  } catch (e) { /* ignore clipboard read errors */ }
}

/* ---------- paste simulation (best effort) ---------- */

function sendCtrlV() {
  const platform = process.platform
  if (platform === 'linux') {
    exec('xdotool key --clearmodifiers ctrl+v', () => {})
  } else if (platform === 'win32') {
    exec('powershell -NoProfile -WindowStyle Hidden -Command "$ws=New-Object -ComObject wscript.shell; $ws.SendKeys(\'^v\')"', () => {})
  } else if (platform === 'darwin') {
    exec('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', () => {})
  }
}

function captureCurrentClipboard() {
  let text = ''
  let imageSig = ''
  try { text = clipboard.readText() } catch (e) { /* ignore */ }
  try {
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      const png = img.toPNG()
      if (png && png.length) imageSig = png.toString('base64')
    }
  } catch (e) { /* ignore */ }
  return { text, imageSig }
}

/* ---------- IPC ---------- */

ipcMain.handle('get-history', () => history)
ipcMain.handle('clear-history', () => {
  clearHistory()
  return history
})
ipcMain.handle('copy-item', (e, index) => {
  const item = history[index]
  if (!item) return false
  if (item.type === 'text') clipboard.writeText(item.data)
  else clipboard.writeImage(nativeImage.createFromDataURL(item.data))
  currentPoll = captureCurrentClipboard()
  return true
})
ipcMain.handle('paste-item', (e, index) => {
  const item = history[index]
  if (!item) return false
  if (item.type === 'text') clipboard.writeText(item.data)
  else clipboard.writeImage(nativeImage.createFromDataURL(item.data))
  currentPoll = captureCurrentClipboard()
  if (win) {
    win.hide()
    setTimeout(sendCtrlV, 120)
  }
  return true
})
ipcMain.handle('delete-item', (e, index) => {
  const item = history[index]
  if (!item) return false
  db.prepare('DELETE FROM history WHERE id = ?').run(item.id)
  refreshHistory()
  if (win && win.isVisible()) win.webContents.send('history-updated', history)
  return true
})
ipcMain.handle('toggle-pin', (e, index) => {
  const item = history[index]
  if (!item) return false
  const pinned = item.pinned ? 0 : 1
  db.prepare('UPDATE history SET pinned = ? WHERE id = ?').run(pinned, item.id)
  item.pinned = !!pinned
  if (win && win.isVisible()) win.webContents.send('history-updated', history)
  return item.pinned
})
ipcMain.on('hide-window', () => { if (win) win.hide() })
ipcMain.on('set-theme', (e, t) => {
  const theme = t === 'light' ? 'light' : 'dark'
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'theme.json'), JSON.stringify(theme)) } catch (err) { /* ignore */ }
  if (win) win.setBackgroundColor(bgColor())
})
ipcMain.on('set-style', (e, s) => {
  const style = s === 'flat' ? 'flat' : 'glass'
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'style.json'), JSON.stringify(style)) } catch (err) { /* ignore */ }
  if (win) win.setBackgroundColor(bgColor())
})

/* ---------- tray ---------- */

function createTray() {
  const icon = nativeImage.createFromBuffer(drawClipboardIcon(32))
  icon.setTemplateImage(false)
  tray = new Tray(icon)
  tray.setToolTip('粘贴板管理 · Paste Manager')
  const menu = Menu.buildFromTemplate([
    { label: '打开粘贴板', click: showWindow },
    { label: '清空历史', click: () => { clearHistory(); if (win) win.webContents.send('history-updated', history) } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => tray.popUpContextMenu(menu))
}

/* ---------- shortcuts ---------- */

function registerShortcuts() {
  // Register Shift+Ctrl+X (Linux/Win: Ctrl+X, Mac: Cmd+X)
  const ok = globalShortcut.register('Shift+CommandOrControl+X', () => showWindow(true))
  if (!ok) console.warn('[paste] 快捷键 Shift+Ctrl+X 注册失败，请检查系统快捷键设置')
  // Escape is handled by the renderer process (keydown listener)
  // and by the window blur event — no global registration needed.
}

/* ---------- lifecycle ---------- */

app.whenReady().then(() => {
  initDb()
  loadWindowState()
  createWindow()
  createTray()
  registerShortcuts()
  setInterval(pollClipboard, POLL_MS)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.setName('Paste Manager')
