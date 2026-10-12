// Case-insensitive match of `term` against a project's title, code, and
// implementing office name.
export function matchesProjectSearch(project, term) {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return [project.title, project.project_code, project.offices?.name].some((field) =>
    field?.toLowerCase().includes(needle),
  )
}
