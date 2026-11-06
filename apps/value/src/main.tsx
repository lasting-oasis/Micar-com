import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CarPage from './car/CarPage.tsx'
import StickerBuilder from './car/StickerBuilder.tsx'
import Door from './door/Door.tsx'
import { useLang } from './i18n.tsx'
import { routeFromHash, sectionFromHash } from './route.ts'

// Hash routes keep the site a single static page on GitHub Pages:
//   (none)              home page, unless the URL carries calculator fields (links shared before #/value existed)
//   #/value             the calculator
//   #/sticker[/<code>]  dealer's window-sheet builder (optionally loaded with a car)
//   #/c/<code>          the page a sheet's QR code opens (#/car/<code> on sheets printed before Nov 2026)
//   #<section-id>       a section of the home page (e.g. #grade); scrolled to after the page renders
function currentSearch(): string {
  try { return window.location.search } catch { return '' }
}

function Router() {
  useLang() // the whole page re-renders when the language changes
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  // Runs after the new page's children have rendered, so the target section exists.
  const previous = useRef(hash)
  useLayoutEffect(() => {
    const changed = previous.current !== hash
    previous.current = hash
    const id = sectionFromHash(hash)
    const el = id ? document.getElementById(id) : null
    if (el) el.scrollIntoView()
    else if (changed) window.scrollTo(0, 0)
  }, [hash])
  const route = routeFromHash(hash, currentSearch())
  if (route.view === 'car') return <CarPage code={route.code ?? ''} />
  if (route.view === 'sticker') return <StickerBuilder code={route.code} />
  if (route.view === 'value') return <App />
  return <Door />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
