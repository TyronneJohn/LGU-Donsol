// Appended to an input's className when its field is invalid (see
// useFieldErrors). Uses the important modifier so it wins over each form's
// own border/ring colors, including their dark: variants.
const INVALID_FIELD_CLASS =
  'border-red-500! dark:border-red-500! ring-1 ring-red-500! focus:border-red-500! focus:ring-red-500!'

export function invalidClass(error) {
  return error ? ` ${INVALID_FIELD_CLASS}` : ''
}

// File inputs have no visible box to outline, so they get a padded red frame.
export function invalidFileClass(error) {
  return error ? ' rounded-md p-1.5 ring-1 ring-red-500' : ''
}
