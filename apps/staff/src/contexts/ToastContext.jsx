import { createContext, useCallback, useMemo, useState } from 'react'
import ToastViewport from '../components/ui/Toast'

export const ToastContext = createContext(undefined)

let toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (type, title, description, duration = 5000) => {
      const id = ++toastId
      setToasts((current) => [...current, { id, type, title, description }])
      if (duration) {
        setTimeout(() => dismiss(id), duration)
      }
      return id
    },
    [dismiss],
  )

  const toast = useMemo(
    () => ({
      success: (title, description) => notify('success', title, description),
      error: (title, description) => notify('error', title, description),
      info: (title, description) => notify('info', title, description),
      warning: (title, description) => notify('warning', title, description),
      dismiss,
    }),
    [notify, dismiss],
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
