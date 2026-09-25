import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'

// Shows the mode a click switches TO: a moon while light, a sun while dark.
export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'
  const Icon = isDark ? Sun : Moon

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
