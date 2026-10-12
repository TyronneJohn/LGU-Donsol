import { useCallback, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from './useToast'

export const CONFIRMED_BY_INPUT_ID = 'confirmed_by_name'

/**
 * "Confirmed By" for a project page. Office accounts are shared, so every
 * save / submit / update on a project must carry the real name of the person
 * doing it (project_confirmations, 20261011130000_project_confirmations.sql).
 *
 *   if (!confirmedBy.require()) return      // before the action
 *   await confirmedBy.record(projectId, 'Submitted for review')   // after it succeeds
 *
 * The name stays filled in after an action, since the same person usually
 * carries on working on the page.
 */
export function useConfirmedBy() {
  const toast = useToast()
  const [name, setNameState] = useState('')
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const setName = useCallback((value) => {
    setNameState(value)
    setError('')
  }, [])

  const require = useCallback(() => {
    const trimmed = name.trim()
    if (trimmed.length >= 2) return true

    const message = trimmed
      ? 'Enter your full name.'
      : 'Type your full name in Confirmed By at the bottom of the page before continuing.'
    setError(message)
    toast.error('Confirmed By is required', message)
    const element = document.getElementById(CONFIRMED_BY_INPUT_ID)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element.focus({ preventScroll: true })
    }
    return false
  }, [name, toast])

  const record = useCallback(
    async (projectId, action) => {
      const { error: insertError } = await supabase.from('project_confirmations').insert({
        project_id: projectId,
        action,
        confirmed_by_name: name.trim(),
      })
      if (insertError) toast.error('Saved, but could not record Confirmed By', insertError.message)
      setRefreshKey((current) => current + 1)
    },
    [name, toast],
  )

  return { name, setName, error, require, record, refreshKey }
}
