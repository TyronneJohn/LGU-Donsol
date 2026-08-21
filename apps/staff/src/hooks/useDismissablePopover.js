import { useCallback, useEffect, useRef, useState } from 'react'

// Shared open/close mechanics for menu-style popovers (notifications, user
// menu): closes on outside click or Escape so every popover doesn't
// reimplement the same listeners.
export function useDismissablePopover() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        close()
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, close])

  return { open, setOpen, close, containerRef }
}
