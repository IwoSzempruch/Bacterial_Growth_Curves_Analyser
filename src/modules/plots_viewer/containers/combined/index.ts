import { CombinedPlotsContainerDefault, type CombinedPlotsContainerDefaultProps } from './CombinedPlotsContainerDefault'

// Each combined-container variant lives in its own file. Register new versions here with a descriptive label.
export type CombinedContainerComponent = typeof CombinedPlotsContainerDefault

export type CombinedContainerDefinition = {
  id: string
  label: string
  filePath: string
  Component: CombinedContainerComponent
}

export const combinedContainers: CombinedContainerDefinition[] = [
  {
    id: 'default',
    label: 'Domyslny kontener wykresów zbiorczych (containers/combined/CombinedPlotsContainerDefault.tsx)',
    filePath: 'src/modules/plots_viewer/containers/combined/CombinedPlotsContainerDefault.tsx',
    Component: CombinedPlotsContainerDefault,
  },
]

export { CombinedPlotsContainerDefault }
export type { CombinedPlotsContainerDefaultProps }
