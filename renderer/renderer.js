const $ = (s) => document.querySelector(s)
const listEl = $('#list')
const searchEl = $('#search')
const toastEl = $('#toast')
const themeEl = $('#theme')

let history = []
let filter = 'all'
let selected = 0

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function filtered() {
  const q = searchEl.value.trim().toLowerCase()
  return history.filter((it) => {
    if (filter === 'pinned') {
      if (!it.pinned) return false
    } else {
      if (filter === 'text' && it.type !== 'text') return false
      if (filter === 'image' && it.type !== 'image') return false
    }
    if (q && it.type === 'text' && !it.data.toLowerCase().includes(q)) return false
    return true
  })
}

function render() {
  const items = filtered()
  if (selected >= items.length) selected = 0
  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty">暂无记录</div>'
    return
  }
  listEl.innerHTML = items.map((it, i) => `
    <li class="item ${i === selected ? 'selected' : ''}" data-i="${i}">
      <button class="pin ${it.pinned ? 'on' : ''}" title="置顶 (P)" data-pin="${i}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </button>
      <button class="del" title="删除 (Del)" data-del="${i}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      ${it.type === 'image'
        ? `<img class="thumb" src="${it.data}" alt=""><div class="meta">${fmtTime(it.ts)}</div>`
        : `<div class="preview">${esc(it.preview)}</div><div class="meta">${fmtTime(it.ts)}</div>`}
    </li>`).join('')
  const sel = listEl.querySelector('.item.selected')
  if (sel) sel.scrollIntoView({ block: 'nearest' })
}

function toast(msg) {
  toastEl.textContent = msg
  toastEl.classList.add('show')
  setTimeout(() => toastEl.classList.remove('show'), 900)
}

async function copy(idx) {
  const items = filtered()
  const real = items[idx]
  const realIdx = history.indexOf(real)
  await window.pasteAPI.copyItem(realIdx)
  toast('已复制 ✓')
}

async function paste(idx) {
  const items = filtered()
  const real = items[idx]
  const realIdx = history.indexOf(real)
  await window.pasteAPI.pasteItem(realIdx)
}

async function del(idx) {
  const items = filtered()
  const real = items[idx]
  const realIdx = history.indexOf(real)
  if (realIdx < 0) return
  await window.pasteAPI.deleteItem(realIdx)
  if (selected >= filtered().length) selected = Math.max(0, filtered().length - 1)
}

async function togglePin(idx) {
  const items = filtered()
  const real = items[idx]
  const realIdx = history.indexOf(real)
  if (realIdx < 0) return
  await window.pasteAPI.togglePin(realIdx)
}

listEl.addEventListener('click', (e) => {
  const pinBtn = e.target.closest('.pin')
  if (pinBtn) {
    togglePin(+pinBtn.dataset.pin)
    return
  }
  const btn = e.target.closest('.del')
  if (btn) {
    del(+btn.dataset.del)
    render()
    return
  }
  const li = e.target.closest('.item')
  if (!li) return
  selected = +li.dataset.i
  render()
  if (e.detail === 2) paste(selected)
  else copy(selected)
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { window.pasteAPI.hideWindow(); return }
  if (e.key === '/') { searchEl.focus(); e.preventDefault(); return }
  const inSearch = document.activeElement === searchEl
  if (!inSearch && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const idx = filterButtons.findIndex(b => b.dataset.f === filter)
    const nextIdx = e.key === 'ArrowLeft' ? (idx - 1 + filterButtons.length) % filterButtons.length : (idx + 1) % filterButtons.length
    setFilter(filterButtons[nextIdx].dataset.f)
    e.preventDefault()
    return
  }
  const items = filtered()
  if (!items.length) return
  if (e.key === 'ArrowDown') { selected = Math.min(selected + 1, items.length - 1); render(); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selected = Math.max(selected - 1, 0); render(); e.preventDefault() }
  else if (e.key === 'Enter') { paste(selected) }
  else if (!inSearch && (e.key === 'Delete' || e.key === 'Backspace')) { del(selected); render() }
  else if (!inSearch && e.key === 'p') { togglePin(selected) }
  else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) { copy(selected) }
})

const filterButtons = [...document.querySelectorAll('#filter [data-f]')]
function setFilter(f) {
  filter = f
  document.querySelectorAll('#filter [data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === f))
  selected = 0
  render()
}
filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.f))
})

$('#clear').addEventListener('click', async () => {
  history = await window.pasteAPI.clearHistory()
  render()
  toast('已清空')
})

searchEl.addEventListener('input', () => { selected = 0; render() })

themeEl.addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  applyTheme(t)
})

function applyTheme(t) {
  document.documentElement.dataset.theme = t
  localStorage.setItem('paste-theme', t)
  window.pasteAPI.setTheme(t)
}

window.pasteAPI.onUpdated((h) => { history = h; render() })

;(async () => {
  applyTheme(localStorage.getItem('paste-theme') || 'light')
  history = await window.pasteAPI.getHistory()
  render()
})()
