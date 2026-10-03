// MPDC's "Request Update" is a plain message to Engineering whose body starts
// with this prefix — there's no separate request table, so this prefix is how
// both sides find the request (MpdcProjectMonitoringDetail sends it,
// Engineering's monitoring pages look it up, and the
// notify_update_request_answered trigger matches it to tell MPDC when
// Engineering answers). Change it in both places.
export const UPDATE_REQUEST_PREFIX = 'Requesting a progress update for '

// How long Engineering has before an unanswered request is flagged. A request
// stays open until the next monitoring update is submitted, however late.
export const UPDATE_REQUEST_DELAYED_AFTER_DAYS = 3
export const UPDATE_REQUEST_MISSED_AFTER_DAYS = 7

export const UPDATE_REQUEST_STATE_LABELS = {
  PENDING: 'Update requested',
  DELAYED: 'Request delayed',
  MISSED: 'Request missed',
}

export const UPDATE_REQUEST_STATE_TONES = {
  PENDING: 'blue',
  DELAYED: 'amber',
  MISSED: 'red',
}

// requestedAt: created_at of MPDC's latest request; lastUpdateAt: created_at
// of the project's latest monitoring update. Returns null when there's no
// open request (none sent, or an update was submitted after it).
export function getUpdateRequestStatus(requestedAt, lastUpdateAt, today = new Date()) {
  if (!requestedAt) return null
  if (lastUpdateAt && new Date(lastUpdateAt) >= new Date(requestedAt)) return null

  const msPerDay = 1000 * 60 * 60 * 24
  const daysPending = Math.max(0, Math.floor((today.getTime() - new Date(requestedAt).getTime()) / msPerDay))
  const state =
    daysPending >= UPDATE_REQUEST_MISSED_AFTER_DAYS
      ? 'MISSED'
      : daysPending >= UPDATE_REQUEST_DELAYED_AFTER_DAYS
        ? 'DELAYED'
        : 'PENDING'

  return { state, daysPending, requestedAt }
}
