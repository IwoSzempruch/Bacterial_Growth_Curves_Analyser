import { ReplicateSelectionContainerDefault, type ReplicateSelectionContainerDefaultProps, type SampleReplicate } from './ReplicateSelectionContainerDefault'

// Replicate-selection containers with custom logic should be added here to expose them in PlotsViewer.
export type ReplicateSelectionContainerComponent = (props: ReplicateSelectionContainerDefaultProps) => JSX.Element

export type ReplicateSelectionContainerDefinition = {
  id: string
  label: string
  filePath: string
  Component: ReplicateSelectionContainerComponent
}

export const replicateSelectionContainers: ReplicateSelectionContainerDefinition[] = [
  {
    id: 'default',
    label: 'Panel wyboru replik domyslny (containers/replicate_selection/ReplicateSelectionContainerDefault.tsx)',
    filePath: 'src/modules/plots_viewer/containers/replicate_selection/ReplicateSelectionContainerDefault.tsx',
    Component: ReplicateSelectionContainerDefault,
  },
]

export { ReplicateSelectionContainerDefault }
export type { ReplicateSelectionContainerDefaultProps, SampleReplicate }
