import { LegendContainerDefault, type LegendContainerDefaultProps } from './LegendContainerDefault'

// Legend container variants live in their own files. Register new options here for discoverability in PlotsViewer.
export type LegendContainerComponent = (props: LegendContainerDefaultProps) => JSX.Element | null

export type LegendContainerDefinition = {
  id: string
  label: string
  filePath: string
  Component: LegendContainerComponent
}

export const legendContainers: LegendContainerDefinition[] = [
  {
    id: 'default',
    label: 'Legenda domyslna (containers/legend/LegendContainerDefault.tsx)',
    filePath: 'src/modules/plots_viewer/containers/legend/LegendContainerDefault.tsx',
    Component: LegendContainerDefault,
  },
]

export { LegendContainerDefault }
export type { LegendContainerDefaultProps }
