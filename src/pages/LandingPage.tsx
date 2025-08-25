import { useApp } from '@/state/store'

export default function LandingPage() {
  const setActiveTab = useApp(s => s.setActiveTab)

  return (
    <div className="landing">
      <div className="landing-content">
        <h1>Bacterial Growth Curves</h1>
        <p>
          A comprehensive web application for analyzing bacterial growth data. 
          Manage samples, convert input files, create mappings, and generate beautiful visualizations.
        </p>
        
        <div className="video-container">
          <div className="video-placeholder">
            <h3>📹 Tutorial Video</h3>
            <p>Learn how to use the Bacterial Growth Curves WebApp</p>
            <p className="small">(Video tutorial will be added here)</p>
          </div>
          <p className="small">
            This tutorial will walk you through all the features: Sample Management, 
            File Conversion, Plate Mapping, Data Assignment, and Visualization.
          </p>
        </div>

        <div className="cta-buttons">
          <button 
            className="cta-btn primary"
            onClick={() => setActiveTab('samples')}
          >
            🧪 Start with Sample Manager
          </button>
          <button 
            className="cta-btn"
            onClick={() => setActiveTab('converter')}
          >
            📁 Convert Input Files
          </button>
          <button 
            className="cta-btn"
            onClick={() => setActiveTab('mapping')}
          >
            🗺️ Create Plate Mappings
          </button>
        </div>
      </div>
    </div>
  )
}