import { useCallback, useState } from 'react'
import { useToast } from './useToast'

/**
 * Per-form "this field is required" state. Keys are the input's element id,
 * so validate() can scroll to and focus the first empty field — the user
 * always sees *which* field is blocking Save/Next, not just a toast.
 *
 *   const { errors, validate, clearError } = useFieldErrors()
 *   if (!validate({ title: !form.title.trim() && 'Enter a project name.' })) return
 *
 * Each check maps an id to an error message, or to a falsy value when that
 * field is fine.
 */
export function useFieldErrors() {
  const toast = useToast()
  const [errors, setErrors] = useState({})

  const validate = useCallback(
    (checks) => {
      const next = Object.fromEntries(Object.entries(checks).filter(([, message]) => message))
      setErrors(next)

      const ids = Object.keys(next)
      if (ids.length === 0) return true

      toast.error(
        'Complete the required fields',
        ids.length === 1 ? next[ids[0]] : `${ids.length} required fields still need to be filled in.`,
      )
      const element = document.getElementById(ids[0])
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.focus({ preventScroll: true })
      }
      return false
    },
    [toast],
  )

  const clearError = useCallback((id) => {
    setErrors((current) => {
      if (!current[id]) return current
      const { [id]: _removed, ...rest } = current
      return rest
    })
  }, [])

  const clearErrors = useCallback(() => setErrors({}), [])

  return { errors, validate, clearError, clearErrors }
}
