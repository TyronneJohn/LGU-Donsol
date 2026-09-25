import { useEffect, useRef } from 'react'

// Per-browser recovery of unsaved form input. A form mirrors its state here
// while it differs from what's already saved, so anything that takes the page
// down without a save — a refresh, a closed tab, a re-render that unmounts the
// route, leaving the page and coming back — doesn't cost the user their
// typing.
//
// Never the source of truth: the moment the form matches its saved/clean
// state the entry is removed, a real save clears it, and a different
// browser or device simply won't have it.
//
// Do not point this at passwords, tokens, or anything else secret. It writes
// plaintext to localStorage, where it survives until something explicitly
// clears it — that is the wrong place for a credential, so Login,
// ResetPassword and the password field on Staff Accounts deliberately don't
// use it.
const DRAFT_STORAGE_PREFIX = 'lgu-donsol:draft:'

export function readDraft(key) {
  if (!key) return null
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    // Private browsing, storage disabled, or corrupt JSON — losing the
    // convenience draft is fine; it just behaves like before this existed.
    return null
  }
}

export function writeDraft(key, value) {
  if (!key) return
  try {
    localStorage.setItem(DRAFT_STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled — same as above.
  }
}

export function clearDraft(key) {
  if (!key) return
  try {
    localStorage.removeItem(DRAFT_STORAGE_PREFIX + key)
  } catch {
    // ignore
  }
}

// A stable string for "has this form actually changed". Keys are sorted
// because a draft round-trips through JSON while a clean form is built
// literal-side, and values are stringified because a number typed into an
// input comes back from JSON as a number on one side and a string on the
// other. Handles a plain string value too (a message composer, say).
function signature(value) {
  if (value == null) return ''
  if (typeof value !== 'object') return String(value)
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key] == null ? '' : String(value[key])]),
  )
}

// Mirrors `value` into storage under `key` for as long as it differs from
// `clean` (the saved row's values, or the empty form for a new one).
//
// `ready` guards the window before a page has finished loading what it's
// editing — writing during it would overwrite a real draft with the blank
// state the form briefly holds. Pass `null` as the key to disable entirely
// (a closed dialog, a form the user hasn't opened).
//
// Restoring is left to the caller, since only it knows when its initial
// state is being built: read the draft with readDraft() at that point and
// use it in place of the clean value. Clearing likewise belongs on the
// save path — see clearDraft().
export function useFormDraft(key, value, clean, ready = true) {
  const valueRef = useRef(value)
  valueRef.current = value

  const valueSignature = signature(value)
  const cleanSignature = signature(clean)

  useEffect(() => {
    if (!key || !ready) return
    if (valueSignature === cleanSignature) {
      clearDraft(key)
      return
    }
    writeDraft(key, valueRef.current)
  }, [key, ready, valueSignature, cleanSignature])
}

// Same comparison the hook uses, for callers that need to ask "is there
// anything unsaved here?" — e.g. a Cancel button deciding whether to confirm.
export function isSameDraft(a, b) {
  return signature(a) === signature(b)
}
