import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CarPage from './car/CarPage.tsx'
import StickerBuilder from './car/StickerBuilder.tsx'

// Hash routes keep the site a single static page on GitHub Pages:
//   #/sticker[/<code>]  dealer's window-sheet builder (optionally loaded with a car)
//   #/car/<code>        the page a sheet's QR code opens
function Router() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const m = hash.match(/^#\/(car|sticker)(?:\/([^?&]*))?/)
  if (m?.[1] === 'car') return <CarPage code={m[2] ?? ''} />
  if (m?.[1] === 'sticker') return <StickerBuilder code={m[2] || undefined} />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
