const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pasteAPI', {
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  copyItem: (index) => ipcRenderer.invoke('copy-item', index),
  pasteItem: (index) => ipcRenderer.invoke('paste-item', index),
  deleteItem: (index) => ipcRenderer.invoke('delete-item', index),
  togglePin: (index) => ipcRenderer.invoke('toggle-pin', index),
  reorderPinned: (ids) => ipcRenderer.invoke('reorder-pinned', ids),
  setTheme: (t) => ipcRenderer.send('set-theme', t),
  setStyle: (s) => ipcRenderer.send('set-style', s),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onUpdated: (cb) => ipcRenderer.on('history-updated', (_e, history) => cb(history))
})
