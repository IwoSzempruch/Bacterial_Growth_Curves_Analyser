import { useState, useRef, useCallback } from 'react'
import MappingCreator from '@/modules/mapping_creator/MappingCreator'
import ConvertAndAssign from '@/modules/convert_assign/ConvertAndAssign'
import { applyImportedFile, describeImportResult } from '@/utils/importers'
import { useApp } from '@/state/store'
import { HelpTooltip } from '@/components/HelpTooltip'

export default function SamplesAndMapping() {
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [help, setHelp] = useState<Record<string, boolean>>({})
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'
  const setupRef = useRef<HTMLButtonElement | null>(null)
  const importAssignRef = useRef<HTMLButtonElement | null>(null)
  const importDataRef = useRef<HTMLButtonElement | null>(null)
  const reportRef = useRef<HTMLButtonElement | null>(null)

  const scrollToBottom = useCallback(() => {
    if (typeof window === 'undefined') return
    const target =
      (document.documentElement && document.documentElement.scrollHeight) ||
      document.body.scrollHeight ||
      0
    window.scrollTo({ top: target, behavior: 'smooth' })
  }, [])

  const handleImport = useCallback(async (file: File) => {
    try {
      const result = await applyImportedFile(file)
      setImportMessage(describeImportResult(result, file.name))
      return true
    } catch (e: any) {
      setImportMessage(`[ERR] ${e?.message ?? String(e)}`)
      return false
    }
  }, [])

  const handleImportWithScroll = useCallback(
    async (file: File) => {
      const ok = await handleImport(file)
      if (ok) scrollToBottom()
    },
    [handleImport, scrollToBottom]
  )

  const importLabel = isPl ? 'Importuj dane' : 'Import data'

  return (
    <div className="setup-page">
      <div className="panel setup-hero">
        <div className="panel-heading with-help">
          <div>
            <div className="eyebrow">Setup</div>
            <h2>{isPl ? 'Przygotuj mapowania i dane' : 'Build your mappings and prepare data'}</h2>
            <p className="small">
              {isPl
                ? 'Twórz mapowania płytek, konwertuj dane pomiarowe i łącz je z próbkami przed analizą.'
                : 'Create plate mappings, convert raw files, and align datasets to samples before smoothing and analysis.'}
            </p>
          </div>
          <button
            ref={setupRef}
            className="help-btn"
            type="button"
            onClick={() => setHelp((h) => ({ ...h, setup: !h.setup }))}
          >
            ?
          </button>
        </div>
        <HelpTooltip anchorRef={setupRef} open={!!help.setup}>
          {isPl
            ? 'Krótki opis procesu: zaimportuj lub zbuduj mapowanie, przygotuj dane pomiarowe, przypisz próbki do dołków i wygeneruj pliki assignment.'
            : 'Quick overview: import or build a mapping, prepare measurement data, assign samples to wells, and generate assignment files.'}
        </HelpTooltip>
      </div>

      <div className="setup-grid">
        <div className="panel panel-landing full-span">
          <div className="panel-heading with-help">
            <div>
              <h3>0. {isPl ? 'Importuj assignment' : 'Import assignment'}</h3>
              <p className="small">
                {isPl
                  ? 'Wczytaj zapisane mapowania (pliki assignment) z wcześniejszych sesji. Tylko JSON.'
                  : 'Load saved plate mappings (assignment files) from previous sessions. JSON only.'}
              </p>
            </div>
            <button
              ref={importAssignRef}
              className="help-btn"
              type="button"
              onClick={() => setHelp((h) => ({ ...h, import: !h.import }))}
            >
              ?
            </button>
          </div>
          <HelpTooltip anchorRef={importAssignRef} open={!!help.import}>
            {isPl
              ? 'Załaduj tylko pliki assignment (.json) zapisane wcześniej. Surowe dane wrzucaj w sekcji 1 poniżej.'
              : 'Load only assignment (.json) files saved earlier. Put raw measurements into section 1 below.'}
          </HelpTooltip>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {isPl ? 'Importuj assignment (.json)' : 'Import assignment (.json)'}
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImportWithScroll(f)
                  e.currentTarget.value = ''
                }}
              />
            </label>
            {importMessage && <div className="small">{importMessage}</div>}
          </div>
        </div>

        <div className="panel panel-soft full-span">
          <div className="panel-heading with-help">
            <div>
              <h3>1. {isPl ? 'Importuj dane pomiarowe' : 'Import data'}</h3>
              <p className="small">
                {isPl
                  ? 'Dodaj surowe pliki pomiarowe w obsługiwanych formatach (CSV/TXT/XLSX/JSON).'
                  : 'Add raw measurement files in supported formats (CSV/TXT/XLSX/JSON).'}
              </p>
            </div>
            <button
              ref={importDataRef}
              className="help-btn"
              type="button"
              onClick={() => setHelp((h) => ({ ...h, importData: !h.importData }))}
            >
              ?
            </button>
          </div>
          <HelpTooltip anchorRef={importDataRef} open={!!help.importData}>
            {isPl
              ? 'Wczytaj surowe pliki pomiarowe (CSV/TXT/XLSX/JSON) do konwersji w panelu poniżej.'
              : 'Load raw measurement files (CSV/TXT/XLSX/JSON) to convert them in the panel below.'}
          </HelpTooltip>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {importLabel}
              <input
                type="file"
                accept=".csv,.txt,.xlsx,.json,text/csv,text/plain,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImport(f)
                  e.currentTarget.value = ''
                }}
              />
            </label>
            {importMessage && <div className="small">{importMessage}</div>}
          </div>
        </div>

        <div className="panel panel-soft full-span">
          <div className="panel-heading with-help">
            <div>
              <h3>1a. {isPl ? 'Zgłoś nieobsługiwany format' : 'Report unsupported format'}</h3>
              <p className="small">
                {isPl
                  ? 'Jeśli Twój plik nie jest obsługiwany, zgłoś format i krótki opis, abyśmy dodali wsparcie.'
                  : 'If your file is unsupported, report the format and a short note so we can add support.'}
              </p>
            </div>
            <button
              ref={reportRef}
              className="help-btn"
              type="button"
              onClick={() => setHelp((h) => ({ ...h, report: !h.report }))}
            >
              ?
            </button>
          </div>
          <HelpTooltip anchorRef={reportRef} open={!!help.report}>
            {isPl
              ? 'Podaj nazwę urządzenia/oprogramowania, rozszerzenie pliku i przykład na którym możemy przetestować.'
              : 'Please share device/software name, file extension, and an example we can test.'}
          </HelpTooltip>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <textarea
              placeholder={isPl ? 'Opisz format pliku...' : 'Describe the file format...'}
              style={{ width: '100%', minHeight: 80 }}
            />
            <button className="btn primary" type="button">
              {isPl ? 'Wyślij zgłoszenie' : 'Submit request'}
            </button>
          </div>
        </div>

        <div className="full-span">
          <MappingCreator />
        </div>
      </div>

      <ConvertAndAssign />
    </div>
  )
}
