import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/jost'
import '@xyflow/react/dist/style.css'
import './styles/theme.css'
import './styles/app.css'
import App from './App'
import { useStudio } from './store'

// Flush the debounced save before the window tears down — a rename or drag in
// the last 500ms before close would otherwise be lost.
window.addEventListener('beforeunload', () => useStudio.getState().flushPersist())

// Suppress default file-drop navigation. The main process also blocks off-origin
// navigation, but stopping it here means a stray drop never even flickers.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
