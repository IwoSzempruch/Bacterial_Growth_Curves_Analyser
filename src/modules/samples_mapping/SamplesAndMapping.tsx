import { useState, useRef, useCallback } from 'react'
import MappingCreator from '@/modules/mapping_creator/MappingCreator'
import ExportDataPanel from '@/modules/convert_assign/ExportDataPanel'
import ConvertAndAssign from '@/modules/convert_assign/ConvertAndAssign'
import { applyImportedFile, describeImportResult } from '@/utils/importers'
import { useApp } from '@/state/store'
import { HelpTooltip } from '@/components/HelpTooltip'

export default function SamplesAndMapping() {
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [help, setHelp] = useState<Record<string, boolean>>({})
  const [showUnsupported, setShowUnsupported] = useState(false)
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'
  const setupRef = useRef<HTMLButtonElement | null>(null)
  const importAssignRef = useRef<HTMLButtonElement | null>(null)
  const importDataRef = useRef<HTMLButtonElement | null>(null)
  const mappingSectionRef = useRef<HTMLDivElement | null>(null)

  const emailAddress = 'growthcurves.analyser@gmail.com'
  const unsupportedSubject = 'Unsupported file format'

  const scrollToMapping = useCallback(() => {
    const target = mappingSectionRef.current
    if (!target || typeof window === 'undefined') return
    const topbar = document.querySelector<HTMLElement>('.topbar')
    const offset = topbar ? topbar.getBoundingClientRect().height + 12 : 12
    const targetY = window.scrollY + target.getBoundingClientRect().top - offset
    window.scrollTo({ top: Math.max(targetY, 0), behavior: 'smooth' })
  }, [])

  const scrollToBottom = useCallback(() => {
    if (typeof window === 'undefined') return
    const target =
      (document.documentElement && document.documentElement.scrollHeight) ||
      document.body.scrollHeight ||
      0
    window.scrollTo({ top: target, behavior: 'smooth' })
  }, [])

  const copyToClipboard = useCallback(
    (text: string, label: string) => {
      try {
        if (navigator?.clipboard?.writeText) {
          void navigator.clipboard.writeText(text)
        } else {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setCopyHint(isPl ? `${label} skopiowano` : `${label} copied`)
      } catch (e) {
        setCopyHint(isPl ? 'Nie udało się skopiować' : 'Copy failed')
      } finally {
        setTimeout(() => setCopyHint(null), 2000)
      }
    },
    [isPl]
  )

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

  const handleImportDataWithQueue = useCallback(
    async (file: File) => {
      const ok = await handleImport(file)
      if (ok) scrollToMapping()
    },
    [handleImport, scrollToMapping]
  )

  return (
    <div className="setup-page">
      <div className="panel setup-hero">
        <div className="panel-heading with-help">
          <div>
            <div className="eyebrow">Setup</div>
            <h2>{isPl ? 'Przygotuj dane' : 'Prepare data'}</h2>
            <p className="small">
              {isPl
                ? 'Wgraj swój plik wejściowy i utwórz listę próbek, następnie przypisz próby do odpowiednich dołków. Utworzysz w ten sposób plik przypisania w formacie JSON (.assignment.json). Jeśli już wcześniej utworzyłeś plik przypisania, możesz go zaimportować poniżej.'
                : 'Upload your input file and create a sample list, then assign samples to the appropriate wells. This way you will create an assignment file in JSON format (.assignment.json). If you have already created an assignment file before, you can import it below.'}
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
            ? 'W tej karcie dane z różnych formatów wejścowych są konwertowane do ujednoliconego formatu, a następnie przypisywane do próbek na podstawie mapowania. Na końcu generowany jest plik przypisania (.assignment.json) do dalszej analizy.'
            : 'In this tab, data from various input formats are converted to a unified format and then assigned to samples based on the mapping. Finally, an assignment file (.assignment.json) is generated for further analysis.'}
        </HelpTooltip>
      </div>

      {showUnsupported && (
        <div className="unsupported-banner" role="alert">
          <div className="unsupported-banner__body">
            <div className="unsupported-banner__text">
              <strong>{isPl ? 'Plik nieobsługiwany?' : 'Unsupported file?'}</strong>
              <p className="small" style={{ marginTop: 6 }}>
                {isPl
                  ? 'Jeśli twój plik nie jest jeszcze obsługiwany przez program, prześlij go proszę na adres'
                  : 'If your file is not supported yet, please send it to'}
                {' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => copyToClipboard(emailAddress, isPl ? 'Email' : 'Email')}
                >
                  {emailAddress}
                </button>{' '}
                {isPl ? 'w temacie maila wpisując:' : 'and use subject:'}{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => copyToClipboard(unsupportedSubject, isPl ? 'Temat' : 'Subject')}
                >
                  {unsupportedSubject}
                </button>
                .{' '}
                {isPl
                  ? 'Jeżeli dane w twoim pliku są wrażliwe lub sam plik jest zbyt duży do przesłania, przygotuj proszę plik uproszczony, zostawiając dane z przynajmniej dwóch punktów czasowych. (kliknij aby skopiować adres lub temat maila).'
                  : 'If your data are sensitive or the file is too large, please prepare a simplified file keeping at least two time points (click to copy email or subject).'}
              </p>
              {copyHint && <div className="small">{copyHint}</div>}
            </div>
            <button className="btn ghost" type="button" onClick={() => setShowUnsupported(false)} aria-label="Close unsupported file banner">
              ×
            </button>
          </div>
        </div>
      )}

      <div className="setup-grid">
        <div className="panel-row full-span">
          <div className="panel panel-landing">
            <div className="panel-heading with-help">
              <div>
                <h3> {isPl ? 'Importuj assignment' : 'Import assignment'}</h3>
                <p className="small">
                  {isPl ? (
                    <>
                      <strong>Jeśli już wcześniej</strong> przypisałeś próby do dołków i przekonwertowałeś dane,
                      zaimportuj plik assignment (.json) tutaj.
                    </>
                  ) : (
                    <>
                      <strong>If you have already</strong> assigned samples to wells and converted data, import the
                      assignment (.json) file here.
                    </>
                  )}
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
                ? 'Załaduj tylko pliki assignment (.json) zapisane wcześniej. Surowe dane wrzucaj w kolejnym panelu.'
                : 'Load only assignment (.json) files saved earlier. Put raw measurements into the next panel.'}
            </HelpTooltip>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="btn basic-btn" style={{ cursor: 'pointer' }}>
                {isPl ? 'Importuj .json' : 'Import .json'}
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

          <div className="panel panel-soft">
            <div className="panel-heading with-help">
              <div>
                <h3> {isPl ? 'Importuj dane pomiarowe' : 'Import data'}</h3>
                <p className="small">
                  {isPl
                    ? 'Dodaj pliki z danymi pomiarowymi. Program przekonwertuje je do formatu wewnętrznego, na którym bazuje dalsza analiza.'
                    : 'Add raw measurement files. The app will convert them to the internal format used for further analysis.'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  ref={importDataRef}
                  className="help-btn"
                  type="button"
                  onClick={() => setHelp((h) => ({ ...h, importData: !h.importData }))}
                >
                  ?
                </button>

              </div>
            </div>
            <HelpTooltip anchorRef={importDataRef} open={!!help.importData}>
              {isPl
                ? 'Wybierz plik z danymi na których chcesz pracować.'
                : 'Select the file with the data you want to work on.'}
            </HelpTooltip>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="btn basic-btn" style={{ cursor: 'pointer' }} onClick={scrollToMapping}>
                {importLabel}
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.json,text/csv,text/plain,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleImportDataWithQueue(f)
                    e.currentTarget.value = ''
                  }}
                />
              </label>
              <button
                className="btn basic-btn"
                type="button"
                onClick={() => setShowUnsupported((v) => !v)}
              >
                {isPl ? 'Plik nieobsługiwany?' : 'Your file is not supported?'}
              </button>
              {importMessage && <div className="small">{importMessage}</div>}
            </div>
          </div>
        </div>

        <ExportDataPanel />

        <div className="full-span">
          <div ref={mappingSectionRef}>
            <MappingCreator onMappingImported={scrollToBottom} />
          </div>
        </div>
      </div>

      <ConvertAndAssign />
    </div>
  )
}
