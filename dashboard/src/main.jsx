/**
 * @fileoverview Vite + React entry: mounts {@link App} under `#root` with StrictMode
 * (double-invokes effects in development to surface unsafe side effects).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
