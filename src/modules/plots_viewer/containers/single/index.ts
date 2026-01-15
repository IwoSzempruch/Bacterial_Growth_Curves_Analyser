import { SamplePlotContainerDefault, type SamplePlotContainerDefaultProps } from './SamplePlotContainerDefault'

// Individual-sample plot containers live in this directory. Register new variants here to expose them to PlotsViewer.
export type SamplePlotContainerComponent = (props: SamplePlotContainerDefaultProps) => JSX.Element

export type SamplePlotContainerDefinition = {
  id: string
  label: string
  filePath: string
  Component: SamplePlotContainerComponent
}

export const samplePlotContainers: SamplePlotContainerDefinition[] = [
  {
    id: 'default',
    label: 'Wykres pojedynczej próby – wersja domyslna (containers/single/SamplePlotContainerDefault.tsx)',
    filePath: 'src/modules/plots_viewer/containers/single/SamplePlotContainerDefault.tsx',
    Component: SamplePlotContainerDefault,
  },
]

export { SamplePlotContainerDefault }
export type { SamplePlotContainerDefaultProps }
