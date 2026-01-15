import type { MutableRefObject, ReactNode } from 'react'

import SimpleLineChart, { type Series } from '@/components/SimpleLineChart'

import { COMBINED_CHART_ASPECT } from '@/modules/plots_viewer/constants'
import type { RawReplicatePointMeta } from '@/modules/plots_viewer/types'
import { PanelWithHelp } from './PanelWithHelp'

type StandardLineChartCardProps = {
  heading: string
  helpContent: ReactNode
  series: Series[]
  chartTitle: string
  xLabel: string
  yLabel: string
  fontScale: number
  chartRef: MutableRefObject<HTMLDivElement | null>
  highlightedNames: string[]
  selectedPointIds: string[]
  resetViewKey?: string
  minPanX?: number
  minPanY?: number
  actions?: ReactNode
  height?: number
  className?: string
  fullscreen?: boolean
  legendEntries?: { id: string; label: string; color: string; hidden?: boolean; kind?: 'series' | 'excluded' }[]
  showLegend?: boolean
  legendTitle?: string
  legendScale?: number
  onPointToggle?: (point: RawReplicatePointMeta) => void
  onPointSelection?: (points: RawReplicatePointMeta[]) => void
  pointMarkers?: 'none' | 'all'
  pointMarkerRadius?: number
  mode?: 'line' | 'scatter'
  pointSelectionMode?: 'modifier' | 'immediate'
}

export function StandardLineChartCard({
  heading,
  helpContent,
  series,
  chartTitle,
  xLabel,
  yLabel,
  fontScale,
  chartRef,
  highlightedNames,
  selectedPointIds,
  resetViewKey,
  minPanX,
  minPanY,
  actions,
  height = 360,
  className = '',
  fullscreen = false,
  legendEntries,
  showLegend,
  legendTitle,
  legendScale,
  onPointToggle,
  onPointSelection,
  pointMarkers = 'none',
  pointMarkerRadius = 3,
  mode = 'scatter',
  pointSelectionMode = 'modifier',
}: StandardLineChartCardProps) {
  const effectiveHeight = fullscreen ? Math.max(height, 900) : height

  return (
    <PanelWithHelp
      title={heading}
      helpContent={helpContent}
      className={`chart-card ${className} ${fullscreen ? 'chart-card--fullscreen' : ''}`.trim()}
      contentClassName="chart-card__body"
      actions={actions}
    >
      <div ref={chartRef} className="chart-card__canvas">
        <SimpleLineChart
          series={series}
          title={chartTitle}
          xLabel={xLabel}
          yLabel={yLabel}
          height={effectiveHeight}
          aspect={COMBINED_CHART_ASPECT}
          minHeight={320}
          maxHeight={640}
          fontScale={fontScale}
          legendMode="none"
          highlightedNames={highlightedNames}
          mode={mode}
          pointMarkers={pointMarkers}
          pointMarkerRadius={pointMarkerRadius}
          selectedPointIds={selectedPointIds}
          pointSelectionMode={pointSelectionMode}
          onPointClick={({ point }) => {
            if (onPointToggle && point.meta)
              onPointToggle(point.meta as RawReplicatePointMeta)
          }}
          onPointSelection={({ points }) => {
            if (!onPointSelection) return
            const metaPoints = points
              .map((entry) => entry.point.meta as RawReplicatePointMeta | undefined)
              .filter((entry): entry is RawReplicatePointMeta => !!entry)
            if (metaPoints.length) onPointSelection(metaPoints)
          }}
          pointFill="solid"
          minPanX={minPanX}
          minPanY={minPanY}
          resetViewKey={resetViewKey}
          scatterSeries={[]}
          scatterPointRadius={3}
          scatterOpacity={1}
          enableDoubleClickReset={false}
          legendEntries={legendEntries}
          showLegend={showLegend}
          legendTitle={legendTitle}
          legendScale={legendScale}
        />
      </div>
    </PanelWithHelp>
  )
}
