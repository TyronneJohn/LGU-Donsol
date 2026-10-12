// Messenger-style presence dot, positioned on the bottom-right of an avatar.
// The parent avatar must be `relative`. Renders nothing when offline.
export default function OnlineDot({ online, size = 'md' }) {
  if (!online) return null
  const sizeClass = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'
  return (
    <span
      className={`absolute bottom-0 right-0 ${sizeClass} rounded-full bg-green-500 ring-2 ring-white dark:ring-[var(--dark-surface)]`}
      aria-label="Online"
      title="Online"
    />
  )
}
