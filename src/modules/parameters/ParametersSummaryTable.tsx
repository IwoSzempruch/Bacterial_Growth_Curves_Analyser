import type React from 'react'
import { useMemo, useRef, useState } from 'react'
import { HelpTooltip } from '@/components/HelpTooltip'
import type { ParameterResult } from '@/utils/parameters'

type ColumnKey = 'sample' | 'replicates' | 'muMax' | 'td' | 'lambda' | 'kHat' | 'odMax' | 'tInflection' | 'auc'

type Column = {
  key: ColumnKey
  labelPl: string
  labelEn: string
  accessor: (row: ParameterResult) => string | number | null | undefined
  isNumeric?: boolean
  digits?: number
}

type SortState = {
  column: ColumnKey | null
  direction: 'asc' | 'desc' | null
}

type ParametersSummaryTableProps = {
  results: ParameterResult[]
  isPl: boolean
  onExportCsv: () => void
}

const DEFAULT_COLLAPSED_HEIGHT = 340

const columns: Column[] = [
  { key: 'sample', labelPl: 'Próba', labelEn: 'Sample', accessor: (row) => row.sample },
  { key: 'replicates', labelPl: 'Repl.', labelEn: 'Rep', accessor: (row) => row.replicates, isNumeric: true, digits: 0 },
  { key: 'muMax', labelPl: 'µmax [1/h]', labelEn: 'µmax [1/h]', accessor: (row) => row.muMax, isNumeric: true },
  { key: 'td', labelPl: 'Td [h]', labelEn: 'Td [h]', accessor: (row) => row.td, isNumeric: true },
  { key: 'lambda', labelPl: 'lag [h]', labelEn: 'lag [h]', accessor: (row) => row.lambda, isNumeric: true },
  { key: 'kHat', labelPl: 'K (95%)', labelEn: 'K (95%)', accessor: (row) => row.kHat, isNumeric: true },
  { key: 'odMax', labelPl: 'OD max', labelEn: 'OD max', accessor: (row) => row.odMax, isNumeric: true },
  { key: 'tInflection', labelPl: 't_inf [h]', labelEn: 't_inf [h]', accessor: (row) => row.tInflection, isNumeric: true },
  { key: 'auc', labelPl: 'AUC', labelEn: 'AUC', accessor: (row) => row.auc, isNumeric: true },
]

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value == null || Number.isNaN(value)) return '-'
  if (!Number.isFinite(value)) return 'inf'
  return Number(value).toFixed(digits)
}

function normalizeSortValue(value: string | number | null | undefined, isNumeric: boolean) {
  if (value == null || value === '') return { missing: true, value: isNumeric ? 0 : '' }
  if (isNumeric) return { missing: false, value: Number(value) }
  return { missing: false, value: String(value) }
}

function ParametersSummaryTable({ results, isPl, onExportCsv }: ParametersSummaryTableProps) {
  const [expanded, setExpanded] = useState<boolean>(false)
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: null })
  const helpAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [helpOpen, setHelpOpen] = useState<boolean>(false)

  const columnMap = useMemo(() => {
    const map = new Map<ColumnKey, Column>()
    columns.forEach((col) => map.set(col.key, col))
    return map
  }, [])

  const sortedResults = useMemo(() => {
    if (!sortState.column || !sortState.direction) return results
    const col = columnMap.get(sortState.column)
    if (!col) return results
    const sorted = [...results].sort((a, b) => {
      const aVal = normalizeSortValue(col.accessor(a), !!col.isNumeric)
      const bVal = normalizeSortValue(col.accessor(b), !!col.isNumeric)
      if (aVal.missing && bVal.missing) return 0
      if (aVal.missing) return 1
      if (bVal.missing) return -1
      if (col.isNumeric) {
        const diff = Number(aVal.value) - Number(bVal.value)
        if (diff === 0) return 0
        return sortState.direction === 'asc' ? diff : -diff
      }
      const result = String(aVal.value).localeCompare(String(bVal.value), undefined, { numeric: true, sensitivity: 'base' })
      return sortState.direction === 'asc' ? result : -result
    })
    return sorted
  }, [results, sortState, columnMap])

  const toggleSort = (key: ColumnKey) => {
    setSortState((prev) => {
      if (prev.column !== key) return { column: key, direction: 'desc' }
      if (prev.direction === 'desc') return { column: key, direction: 'asc' }
      return { column: null, direction: null }
    })
  }

  const description = isPl
    ? 'Podsumowanie wygladzonych krzywych wraz z najwazniejszymi parametrami. Uzyj sortowania, aby szybko znalezc proby odstajace.'
    : 'Summary of smoothed curves with key parameters. Use sorting to quickly spot outliers.'

  return (
    <div
      className="panel panel-soft"
      id="parameters-summary"
      style={{ marginTop: 16, position: 'relative' }}
    >
      <button
        ref={helpAnchorRef}
        className="help-btn circle"
        type="button"
        onClick={() => setHelpOpen((open) => !open)}
        aria-label={isPl ? 'Pomoc: Podsumowanie' : 'Help: Summary'}
        style={{ position: 'absolute', top: 12, right: 12 }}
      >
        ?
      </button>
      <div className="panel-heading with-help panel-heading--centered">
        <div>
          <h3>{isPl ? 'Podsumowanie' : 'Summary'}</h3>
          <p className="small">{description}</p>
        </div>
      </div>

      <HelpTooltip anchorRef={helpAnchorRef} open={helpOpen}>
        {isPl
          ? 'Tabela zawiera zagregowane parametry dla kazdej proby. Kliknij naglowek, aby sortowac rosnaco/malejaco. Przyciskiem z boku rozwiniesz lub zwiniesz widok.'
          : 'The table lists aggregated parameters per sample. Click a header to sort ascending/descending. Use the toggle to expand or collapse the view.'}
      </HelpTooltip>

      <div
        className="table-scroll"
        style={{
          marginTop: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: expanded ? 'visible' : 'auto',
          maxHeight: expanded ? 'none' : DEFAULT_COLLAPSED_HEIGHT,
        }}
      >
        {results.length === 0 ? (
          <div className="empty-state" style={{ padding: '12px 14px' }}>
            {isPl ? 'Wczytaj dane, aby zobaczyć parametry.' : 'Load data to see the parameters.'}
          </div>
        ) : (
          <table className="table" style={{ margin: 0, minWidth: 760 }}>
            <thead>
              <tr>
                {columns.map((col) => {
                  const isActive = sortState.column === col.key && !!sortState.direction
                  const indicator = !isActive ? '*' : sortState.direction === 'asc' ? '^' : 'v'
                  return (
                    <th key={col.key} style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{isPl ? col.labelPl : col.labelEn}</span>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => toggleSort(col.key)}
                          aria-label={
                            isPl
                              ? `Sortuj po ${col.labelPl}`
                              : `Sort by ${col.labelEn}`
                          }
                          style={{
                            padding: '2px 6px',
                            lineHeight: 1,
                            minWidth: 32,
                            fontSize: 12,
                          }}
                        >
                          {indicator}
                        </button>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((row) => (
                <tr key={row.sample}>
                  {columns.map((col) => {
                    const raw = col.accessor(row)
                    const isMissing = raw == null || raw === ''
                    const value =
                      isMissing && col.key !== 'replicates'
                        ? '-'
                        : col.isNumeric
                          ? formatNumber(Number(raw), col.digits ?? 3)
                          : String(raw ?? '')
                    return <td key={col.key}>{value}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        className="row"
        style={{ gap: 10, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}
      >
        <button
          className="btn basic-btn"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={!results.length}
        >
          {expanded ? (isPl ? 'Zwiń tabelę' : 'Collapse table') : (isPl ? 'Rozwiń tabelę' : 'Expand table')}
        </button>
        <button
          className="btn basic-btn"
          type="button"
          onClick={onExportCsv}
          disabled={!results.length}
        >
          {isPl ? 'Eksportuj tabelę (.csv)' : 'Export table (.csv)'}
        </button>
      </div>
    </div>
  )
}

export default ParametersSummaryTable
