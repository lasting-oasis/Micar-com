// Pure hash routing for the value app: no DOM access, no side effects.
export type ValueRoute = { view: 'car' | 'sticker' | 'value' | 'door'; code?: string }

export function routeFromHash(hash: string, search: string): ValueRoute {
  const m = hash.match(/^#\/(car|c|sticker|value)(?:\/([^?&]*))?/)
  // 'car' must come before 'c' in the regex, or '#/car/abc' matches 'c' and loses its code.
  if (m?.[1] === 'c' || m?.[1] === 'car') return { view: 'car', code: m[2] ?? '' }
  if (m?.[1] === 'sticker') return { view: 'sticker', code: m[2] || undefined }
  // Links shared before #/value existed carry the calculator fields in the query string.
  if (m?.[1] === 'value' || /[?&](make|model|msrp|year)=/.test(search)) return { view: 'value' }
  return { view: 'door' }
}

// '#grade' -> 'grade'. Anything that is not a bare section id (routes, '#', '#link=abc', bad escapes) -> null.
export function sectionFromHash(hash: string): string | null {
  const m = hash.match(/^#([A-Za-z][\w-]*)$/)
  return m ? m[1] : null
}
