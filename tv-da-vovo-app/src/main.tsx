import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { observarSafeArea } from './utils/safeArea'
import { ligarPreviaNoPc } from './utils/previaNoPc'

// previa no navegador do PC: os streams passam pelo proxy do vite
if (import.meta.env.DEV) ligarPreviaNoPc()

// Antes do primeiro desenho: senao o cabecalho pisca por baixo do relogio
observarSafeArea()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
