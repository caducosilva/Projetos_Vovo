import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { observarSafeArea } from './utils/safeArea'

// Antes do primeiro desenho: senao o cabecalho pisca por baixo do relogio
observarSafeArea()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
