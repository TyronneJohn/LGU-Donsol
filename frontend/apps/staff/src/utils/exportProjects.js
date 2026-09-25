import ExcelJS from 'exceljs'
import { PROJECT_STATUS_LABELS, SECTOR_LABELS, SECTOR_ORDER } from '@shared/utils/projectStatus'

// Reproduces the LGU Donsol MPDC physical/financial accomplishment report
// format (per the reference workbook the professor supplied): a 2-row
// header with "PROJECT STATUS" spanning two subcolumns, projects grouped
// A/B/C by sector then by program/activity, and a totalled TOTAL row.
// Only real project data is ever written here — see toExportRow for the
// exact field mapping and which report columns are left blank because no
// corresponding field exists in the schema (Total Cost Incurred to Date,
// No. of Extensions).

const SECTOR_PREFIXES = { SOCIAL_DEVELOPMENT: 'A', ECONOMIC_DEVELOPMENT: 'B', ENVIRONMENTAL_MANAGEMENT: 'C' }

const CURRENCY_FORMAT = '_-"₱"* #,##0.00_-;-"₱"* #,##0.00_-;_-"₱"* "-"??_-;_-@_-'
const ACCOUNTING_FORMAT = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)'
const PERCENT_FORMAT = '0.00%'
const DATE_FORMAT = 'mmm d, yyyy'

const THIN = { style: 'thin', color: { argb: 'FF000000' } }
const ALL_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN }

const COL_COUNT = 9 // A..I
// Character widths for columns A, B, I — the wrapped-text columns whose
// content determines a data row's height (kept in sync with sheet.columns
// below, which uses the same widths).
const WRAP_COL_WIDTHS = { 1: 40, 2: 26, 9: 30 }

// Excel doesn't reliably auto-fit row heights for wrapped text on first
// open in every viewer, so estimate one from the longest wrapped column
// instead of leaving long titles/locations/remarks clipped.
function estimateRowHeight(project) {
  const lineEstimates = [
    Math.ceil((project.title?.length || 0) / WRAP_COL_WIDTHS[1]),
    Math.ceil((project.location?.length || 0) / WRAP_COL_WIDTHS[2]),
    Math.ceil((project.remarks?.length || 0) / WRAP_COL_WIDTHS[9]),
  ]
  const lines = Math.max(1, ...lineEstimates)
  return Math.min(150, Math.max(20, lines * 15))
}

function borderRow(row) {
  for (let c = 1; c <= COL_COUNT; c++) row.getCell(c).border = ALL_BORDERS
}

function buildHeader(sheet) {
  const r1 = sheet.getRow(1)
  const r2 = sheet.getRow(2)
  r1.height = 30
  r2.height = 30

  const singleColHeaders = [
    [1, 'Programs/Project/Activities'],
    [2, 'LOCATION'],
    [3, 'Total Cost'],
    [4, 'Date Started'],
    [5, 'Target Completion Date'],
    [8, 'No. of Extensions, if any'],
    [9, 'Remarks'],
  ]
  for (const [col, label] of singleColHeaders) {
    sheet.mergeCells(1, col, 2, col)
    r1.getCell(col).value = label
  }

  sheet.mergeCells(1, 6, 1, 7)
  r1.getCell(6).value = 'PROJECT STATUS'
  r2.getCell(6).value = '% of completion'
  r2.getCell(7).value = 'Total Cost Incurred to Date'

  for (const row of [r1, r2]) {
    for (let c = 1; c <= COL_COUNT; c++) {
      const cell = row.getCell(c)
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    }
    borderRow(row)
  }
}

function addSectorRow(sheet, label) {
  const row = sheet.addRow([label])
  row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  for (let c = 1; c <= COL_COUNT; c++) {
    const cell = row.getCell(c)
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } }
  }
  borderRow(row)
  return row
}

function addProgramRow(sheet, programLabel) {
  const row = sheet.addRow([programLabel])
  row.getCell(1).font = { bold: true }
  row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  borderRow(row)
  return row
}

function addProjectRow(sheet, project) {
  const row = sheet.addRow([
    project.title,
    project.location,
    project.total_cost,
    project.date_started,
    project.target_completion_date,
    project.percent_complete,
    project.cost_incurred_to_date,
    project.extensions,
    project.remarks,
  ])

  row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(3).numFmt = CURRENCY_FORMAT
  row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(6).numFmt = PERCENT_FORMAT
  row.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(7).numFmt = ACCOUNTING_FORMAT
  row.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(9).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  row.getCell(9).font = { bold: true }

  if (project.date_started instanceof Date) row.getCell(4).numFmt = DATE_FORMAT
  if (project.target_completion_date instanceof Date) row.getCell(5).numFmt = DATE_FORMAT

  row.height = estimateRowHeight(project)

  borderRow(row)
  return row
}

function addTotalRow(sheet, totalCostFormulaRange) {
  const row = sheet.addRow(['', 'TOTAL', totalCostFormulaRange ? { formula: totalCostFormulaRange } : ''])
  row.getCell(2).font = { bold: true }
  row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(3).font = { bold: true }
  row.getCell(3).numFmt = CURRENCY_FORMAT
  row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' }
  row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }
  borderRow(row)
  return row
}

/**
 * Builds the styled, sector-grouped LGU accomplishment report workbook from
 * already-fetched, flattened project rows (see toExportRow). Pure — returns
 * the ExcelJS workbook without touching the DOM, so it's usable from both
 * the browser export flow below and from tests.
 */
export function buildProjectReportWorkbook(rows, { quarterLabel, periodEnd } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LGU Donsol Project Monitoring System'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(quarterLabel || 'Report', {
    pageSetup: {
      orientation: 'landscape',
      paperSize: 14,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.5, header: 0.3, footer: 0.3 },
      printTitlesRow: '1:2',
    },
  })

  const periodLine = periodEnd ? `as of ${periodEnd}` : ''
  sheet.headerFooter = {
    oddHeader: `&C&"-,Bold"&12&KFF0000PROJECT MONITORING REPORT&K01+000\n${periodLine}\nLGU-DONSOL, SORSOGON`,
    oddFooter: '&RPage &P of &N',
  }

  sheet.columns = [
    { width: 40 },
    { width: 26 },
    { width: 17 },
    { width: 13 },
    { width: 16 },
    { width: 11 },
    { width: 18 },
    { width: 11 },
    { width: 30 },
  ]

  buildHeader(sheet)

  const bySector = new Map()
  for (const row of rows) {
    const key = row.sector && SECTOR_LABELS[row.sector] ? row.sector : null
    if (!bySector.has(key)) bySector.set(key, [])
    bySector.get(key).push(row)
  }

  let firstDataRow = null
  let lastDataRow = null

  for (const sector of SECTOR_ORDER) {
    const projects = bySector.get(sector)
    if (!projects || projects.length === 0) continue

    addSectorRow(sheet, `${SECTOR_PREFIXES[sector]}. ${SECTOR_LABELS[sector].toUpperCase()}`)

    const byProgram = new Map()
    for (const project of projects) {
      const key = project.program || ''
      if (!byProgram.has(key)) byProgram.set(key, [])
      byProgram.get(key).push(project)
    }

    const programKeys = [...byProgram.keys()].sort((a, b) => a.localeCompare(b))
    for (const programKey of programKeys) {
      if (programKey) addProgramRow(sheet, programKey.toUpperCase())

      const projectsInProgram = byProgram.get(programKey).sort((a, b) => a.title.localeCompare(b.title))
      for (const project of projectsInProgram) {
        const dataRow = addProjectRow(sheet, project)
        if (firstDataRow === null) firstDataRow = dataRow.number
        lastDataRow = dataRow.number
      }
    }
  }

  // Uncategorized projects (no matching sector) still get exported, never
  // silently dropped, grouped under a clearly-labeled catch-all.
  const uncategorized = bySector.get(null)
  if (uncategorized && uncategorized.length > 0) {
    addSectorRow(sheet, 'UNCATEGORIZED')
    for (const project of uncategorized.sort((a, b) => a.title.localeCompare(b.title))) {
      const dataRow = addProjectRow(sheet, project)
      if (firstDataRow === null) firstDataRow = dataRow.number
      lastDataRow = dataRow.number
    }
  }

  const totalFormula = firstDataRow ? `SUM(C${firstDataRow}:C${lastDataRow})` : null
  addTotalRow(sheet, totalFormula)

  sheet.pageSetup.printArea = `A1:I${sheet.lastRow.number}`

  return workbook
}

/**
 * Builds the report workbook and triggers a browser download. Read-only —
 * never touches the database.
 */
export async function exportProjectsToExcel(rows, { quarterLabel, periodEnd, filenamePrefix = 'LGU-Donsol-Project-Report' } = {}) {
  const workbook = buildProjectReportWorkbook(rows, { quarterLabel, periodEnd })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const dateStamp = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${filenamePrefix}-${dateStamp}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Normalizes a raw Supabase project row (plus its joined progress/
 * procurement data) into the flat shape exportProjectsToExcel expects.
 * Every value here traces back to an existing database column — fields the
 * schema doesn't have (cost incurred to date, extension count) are left
 * null so the report cell renders blank rather than a fabricated value.
 */
export function toExportRow(project) {
  const statusLabel = PROJECT_STATUS_LABELS[project.status] ?? project.status
  const remarks = project.latest_issues ? `${statusLabel} — ${project.latest_issues}` : statusLabel

  return {
    sector: project.sector,
    program: project.project_category || '',
    title: project.title,
    location: project.location_text || project.barangay || '',
    total_cost: project.approved_budget ?? project.estimated_cost ?? null,
    date_started: toDate(project.start_date_actual ?? project.start_date_planned),
    target_completion_date: toDate(project.end_date_planned),
    percent_complete: project.progress_percentage != null ? Number(project.progress_percentage) / 100 : null,
    cost_incurred_to_date: null,
    extensions: null,
    remarks,
  }
}
