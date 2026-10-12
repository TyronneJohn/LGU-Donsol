import { Search } from 'lucide-react'

// Client-side search box shared by the project list pages (MPDC My
// Projects / Monitoring / Published Projects, Engineering Site Monitoring).
export default function SearchInput({ value, onChange, placeholder = 'Search projects' }) {
  return (
    <div className="mb-4 max-w-sm">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-md border border-slate-400 dark:border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </div>
    </div>
  )
}
