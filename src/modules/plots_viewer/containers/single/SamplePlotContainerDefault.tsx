import type { Dispatch, SetStateAction } from 'react'
import SimpleLineChart, { type Series } from '@/components/SimpleLineChart'
import { COMBINED_CHART_ASPECT } from '../../constants'

// Default per-sample plot container used by PlotsViewer.tsx.
// Add alternative single plot layouts by dropping components into src/modules/plots_viewer/containers/single.

export type SamplePlotContainerDefaultProps = {
  sampleIndex: number
  setSampleIndex: Dispatch<SetStateAction<number>>
  orderedSamples: string[]
  perSampleSeries: Series[]
  currentSample: string | null
  datasetSourceLabel: string
  measurementLabel: string
  fontScale: number
}

export function SamplePlotContainerDefault({
  sampleIndex,
  setSampleIndex,
  orderedSamples,
  perSampleSeries,
  currentSample,
  datasetSourceLabel,
  measurementLabel,
  fontScale,
}: SamplePlotContainerDefaultProps) {
  const total = orderedSamples.length

  return (
    <div className='panel' style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button className='btn' onClick={() => setSampleIndex(i => Math.max(0, i - 1))} disabled={sampleIndex <= 0} aria-label='Previous sample'>?</button>
        <div className='badge'>{total ? `${sampleIndex + 1} / ${total}` : '0 / 0'}</div>
        <button className='btn' onClick={() => setSampleIndex(i => Math.min(total - 1, i + 1))} disabled={sampleIndex >= total - 1} aria-label='Next sample'>?</button>
      </div>

      <div style={{ marginTop: 8 }}>
        <SimpleLineChart
          series={perSampleSeries}
          title={currentSample ? `${currentSample} - ${datasetSourceLabel}` : ''}
          xLabel='Time (min)'
          yLabel={measurementLabel || 'Value'}
          height={380}
          aspect={COMBINED_CHART_ASPECT}
          minHeight={320}
          maxHeight={640}
          fontScale={fontScale}
        />
      </div>
    </div>
  )
}
