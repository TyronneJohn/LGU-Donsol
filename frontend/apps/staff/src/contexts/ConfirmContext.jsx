import { createContext, useCallback, useMemo, useState } from 'react'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export const ConfirmContext = createContext(undefined)

// Imperative confirm() that resolves true/false, backed by a single shared
// dialog instance — a destructive action can `await confirm({...})` instead
// of every call site wiring its own modal open state.
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setState({ options, resolve })
    })
  }, [])

  function handleConfirm() {
    state?.resolve(true)
    setState(null)
  }

  function handleCancel() {
    state?.resolve(false)
    setState(null)
  }

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(state)}
        title={state?.options?.title ?? ''}
        description={state?.options?.description}
        confirmLabel={state?.options?.confirmLabel}
        cancelLabel={state?.options?.cancelLabel}
        tone={state?.options?.tone}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  )
}
