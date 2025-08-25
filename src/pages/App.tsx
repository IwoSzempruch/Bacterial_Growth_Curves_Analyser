import { useApp } from '@/state/store'
import LandingPage from './LandingPage'
import SampleManager from '@/modules/sample_manager/SampleManager'
import InputFilesConverter from '@/modules/input_files_converter/InputFilesConverter'
import MappingManager from '@/modules/mapping_manager/MappingManager'
import MappingAssigner from '@/modules/mapping_assigner/MappingAssigner'
import PlotsViewer from '@/modules/plots_viewer/PlotsViewer'
import OutputCreator from '@/modules/output_file_creator/OutputCreator'
import InteractivePlotsViewer from '@/modules/interactive_plots_viewer/InteractivePlotsViewer'
import InteractivePlotsCompiler from '@/modules/interactive_plots_compiler/InteractivePlotsCompiler'
import DataAnalyser from '@/modules/data_analyser/DataAnalyser'

const tabs = [
  { id: 'home', label: 'Home'},
  { id: 'samples', label: 'Sample Manager'},
  { id: 'mapping', label: 'Mapping Manager'},
  { id: 'converter', label: 'Input Files Converter'},
  { id: 'assign', label: 'Mapping Assigner'},
  { id: 'plots', label: 'Plots Viewer'},
  { id: 'interactive', label: 'Interactive Plots'},
  { id: 'compiler', label: 'Plots Compiler'},
  { id: 'output', label: 'Output CSV'},
  { id: 'analysis', label: 'Data Analyser'}
]

export default function App(){
  const activeTab = useApp(s=>s.activeTab)
  const setActiveTab = useApp(s=>s.setActiveTab)

  return (
    <div className="app">
      {activeTab !== 'home' && (
        <div className="topbar">
          <div className="logo">Bacterial Growth Curves</div>
          <div className="nav" role="tablist" aria-label="Modules">
            {tabs.map(t => (
              <button key={t.id}
                className={['', activeTab===t.id?'active':''].join(' ')}
                onClick={()=>setActiveTab(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="container">
        {activeTab==='home' && <LandingPage/>}
        {activeTab==='samples' && <SampleManager/>}
        {activeTab==='converter' && <InputFilesConverter/>}
        {activeTab==='mapping' && <MappingManager/>}
        {activeTab==='assign' && <MappingAssigner/>}
        {activeTab==='plots' && <PlotsViewer/>}
        {activeTab==='interactive' && <InteractivePlotsViewer/>}
        {activeTab==='compiler' && <InteractivePlotsCompiler/>}
        {activeTab==='output' && <OutputCreator/>}
        {activeTab==='analysis' && <DataAnalyser/>}
      </div>
    </div>
  )
}
