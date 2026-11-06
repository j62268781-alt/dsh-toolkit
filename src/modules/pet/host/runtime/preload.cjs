'use strict'
const { contextBridge, ipcRenderer } = require('electron')
function subscribe(channel, listener) {
  if (typeof listener !== 'function') return () => {}
  const handler = (_event, value) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
contextBridge.exposeInMainWorld('pet', Object.freeze({
  initial: () => ipcRenderer.invoke('pet:initial'),
  action: value => ipcRenderer.invoke('pet:action', value),
  interactive: value => ipcRenderer.send('pet:interactive', Boolean(value)),
  focus: () => ipcRenderer.send('pet:focus'),
  drag: value => { if (['start', 'move', 'end'].includes(value)) ipcRenderer.send('pet:drag', value) },
  onState: listener => subscribe('pet:state', listener),
  onCollapse: listener => subscribe('pet:collapse', listener),
}))
