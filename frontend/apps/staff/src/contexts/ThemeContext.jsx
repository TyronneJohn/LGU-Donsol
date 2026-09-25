import { createContext, useCallback, useEffect, useMemo, useState } from 'react'

export const ThemeContext = createContext(undefined)

// Same key the inline script in apps/staff/index.html reads before first
// paint, so a saved dark preference never flashes light on load.
export const THEME_STORAGE_KEY = 'lgu-donsol:theme'

function readTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function writeTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private browsing, storage disabled, or quota exceeded — the choice
    // still applies for this visit; it just defaults to light next time.
  }
}

// Light by default; dark only once a user picks it with the Topbar toggle.
// The whole dark palette hangs off the `dark` class on <html> (see
// shared/src/styles/index.css), so this only has to flip that one class.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      writeTheme(next)
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, isDark: theme === 'dark', toggleTheme }), [theme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
