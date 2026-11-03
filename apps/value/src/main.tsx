import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CarPage from './car/CarPage.tsx'
import StickerBuilder from './car/StickerBuilder.tsx'
import Landing from './Landing.tsx'
import { useLang } from './i18n.tsx'

// Hash routes keep the site a single static page on GitHub Pages:
//   (none)              home page, unless the URL carries calculator fields (links shared before #/value existed)
//   #/value             the calculator
//   #/sticker[/<code>]  dealer's window-sheet builder (optionally loaded with a car)
//   #/c/<code>          the page a sheet's QR code opens (#/car/<code> on sheets printed before Nov 2026)
function legacyCalculatorLink(): boolean {
  try { return /[?&](make|model|msrp|year)=/.test(window.location.search) } catch { return false }
}

function Router() {
  useLang() // the whole page re-renders when the language changes
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const m = hash.match(/^#\/(c|car|sticker|value)(?:\/([^?&]*))?/)
  if (m?.[1] === 'c' || m?.[1] === 'car') return <CarPage code={m[2] ?? ''} />
  if (m?.[1] === 'sticker') return <StickerBuilder code={m[2] || undefined} />
  if (m?.[1] === 'value' || legacyCalculatorLink()) return <App />
  return <Landing />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
