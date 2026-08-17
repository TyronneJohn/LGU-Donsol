import * as XLSX from 'xlsx'
import { PROJECT_STATUS_LABELS, PROCUREMENT_STATUS_LABELS } from './projectStatus'

// Column order matches the requested report columns exactly. Every value is
// either a real projects column or a simple join already present in the
// schema (procurement/contractor/progress/latest monitoring date) — nothing
// invented. Callers pass already-merged, flat rows (see MpdcDashboard.jsx
// for how those rows are built from projects + project_updates +
// procurement).
const COLUMNS = [
  { header: 'Project Code', key: 'project_code', type: 'text', wch: 14 },
  { header: 'Project Title', key: 'title', type: 'text', wch: 32 },
  { header: 'Description', key: 'description', type: 'text', wch: 40 },
  { header: 'Project Type', key: 'project_category', type: 'text', wch: 18 },
  { header: 'Implementing Office', key: 'office_name', type: 'text', wch: 22 },
  { header: 'Barangay', key: 'barangay', type: 'text', wch: 16 },
  { header: 'Location', key: 'location_text', type: 'text', wch: 26 },
  { header: 'Latitude', key: 'latitude', type: 'number', wch: 11 },
  { header: 'Longitude', key: 'longitude', type: 'number', wch: 11 },
  { header: 'Budget / ABC (PHP)', key: 'budget', type: 'currency', wch: 16 },
  { header: 'Funding Source', key: 'funding_source', type: 'text', wch: 20 },
  { header: 'Planned Start Date', key: 'start_date_planned', type: 'date', wch: 15 },
  { header: 'Planned End Date', key: 'end_date_planned', type: 'date', wch: 15 },
  { header: 'Actual Start Date', key: 'start_date_actual', type: 'date', wch: 15 },
  { header: 'Actual End Date', key: 'end_date_actual', type: 'date', wch: 15 },
  { header: 'Project Status', key: 'status_label', type: 'text', wch: 18 },
  { header: 'Procurement Status', key: 'procurement_status_label', type: 'text', wch: 18 },
  { header: 'Contractor', key: 'contractor_name', type: 'text', wch: 22 },
  { header: 'Progress %', key: 'progress_percentage', type: 'percent', wch: 11 },
  { header: 'Latest Monitoring Date', key: 'latest_monitoring_date', type: 'date', wch: 18 },
  { header: 'Created Date', key: 'created_at', type: 'date', wch: 14 },
]

const NUMBER_FORMATS = {
  currency: '"₱"#,##0',
  percent: '0.0"%"',
  date: 'yyyy-mm-dd',
}

function toCell(value, type) {
  if (value === null || value === undefined || value === '') return { t: 's', v: '' }

  if (type === 'number' || type === 'currency' || type === 'percent') {
    const num = Number(value)
    if (Number.isNaN(num)) return { t: 's', v: '' }
    return { t: 'n', v: num, ...(NUMBER_FORMATS[type] ? { z: NUMBER_FORMATS[type] } : {}) }
  }

  if (type === 'date') {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return { t: 's', v: '' }
    return { t: 'd', v: date, z: NUMBER_FORMATS.date }
  }

  return { t: 's', v: String(value) }
}

/**
 * Builds a genuine .xlsx workbook from already-fetched, flattened project
 * rows and triggers a browser download. Read-only — never touches the
 * database. Reused by every export entry point so there is exactly one
 * place that defines the report's columns and formatting.
 */
export function exportProjectsToExcel(rows, { filenamePrefix = 'project-report' } = {}) {
  const headerRow = COLUMNS.map((col) => col.header)
  const dataRows = rows.map((row) => COLUMNS.map((col) => toCell(row[col.key], col.type)))

  const worksheet = XLSX.utils.aoa_to_sheet([headerRow])
  dataRows.forEach((cells, rowIndex) => {
    cells.forEach((cell, colIndex) => {
      const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })
      worksheet[address] = cell
    })
  })

  const lastRow = dataRows.length + 1
  worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(lastRow - 1, 0), c: COLUMNS.length - 1 } })
  worksheet['!cols'] = COLUMNS.map((col) => ({ wch: col.wch }))
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: COLUMNS.length - 1 } }) }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Projects')

  const dateStamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${filenamePrefix}-${dateStamp}.xlsx`)
}

/**
 * Normalizes a raw Supabase project row (plus its joined progress/
 * procurement data) into the flat shape exportProjectsToExcel expects.
 */
export function toExportRow(project) {
  return {
    ...project,
    office_name: project.offices?.name ?? '',
    budget: project.approved_budget ?? project.estimated_cost,
    status_label: PROJECT_STATUS_LABELS[project.status] ?? project.status,
    procurement_status_label: project.procurement_status
      ? (PROCUREMENT_STATUS_LABELS[project.procurement_status] ?? project.procurement_status)
      : '',
  }
}
