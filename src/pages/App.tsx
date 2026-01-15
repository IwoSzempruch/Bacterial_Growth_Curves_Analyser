import { useApp } from '@/state/store'
import LandingPage from './LandingPage'
import SamplesAndMapping from '@/modules/samples_mapping/SamplesAndMapping'
import PlotsViewer from '@/modules/plots_viewer/PlotsViewer'
import BlankCorrectionCheck from '@/modules/interactive_plots_viewer/InteractivePlotsViewer'
import CurvesSmoothing from '@/modules/curves_smoothing/CurvesSmoothing'
import Parameters from '@/modules/parameters/Parameters'
import NavigationBar from '@/components/NavigationBar'
import Footer from '@/components/Footer'
import { useEffect } from 'react'

export default function App(){
  const activeTab = useApp(s=>s.activeTab === 'logPhase' ? 'parameters' : s.activeTab)
  const theme = useApp(s => s.theme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div className="app">
      <NavigationBar />
      <main className="main">
        {activeTab==='home' ? (
          <LandingPage/>
        ) : (
          <div className="container">
            {activeTab==='samplesMapping' && <SamplesAndMapping/>}
            <div
              style={{
                display: activeTab === 'plots' ? 'block' : 'none',
              }}
              aria-hidden={activeTab === 'plots' ? undefined : true}
            >
              <PlotsViewer/>
            </div>
            <div
              style={{
                display: activeTab === 'interactive' ? 'block' : 'none',
              }}
              aria-hidden={activeTab === 'interactive' ? undefined : true}
            >
              <BlankCorrectionCheck/>
            </div>
            <div
              style={{
                display: activeTab === 'compiler' ? 'block' : 'none',
              }}
              aria-hidden={activeTab === 'compiler' ? undefined : true}
            >
              <CurvesSmoothing/>
            </div>
            {activeTab==='parameters' && <Parameters/>}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
