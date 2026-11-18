import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GameProvider } from './app/GameProvider'
import { AudioProvider } from './app/AudioProvider'
import './styles/tokens.css'
import './styles/global.css'
import './styles/app.css'
import './styles/motion.css'
import './styles/a11y.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameProvider>
      <AudioProvider>
        <App />
      </AudioProvider>
    </GameProvider>
  </StrictMode>,
)
