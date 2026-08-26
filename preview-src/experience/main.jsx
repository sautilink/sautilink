import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import ExperiencePreview from '../app-shell/ExperiencePreview.jsx';
import '../app-shell/styles.css';
import './ExperiencePreview.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="discover"
      enableMediaPreview
      enableConversationPreview
      enableExperiencePreview
      experienceComponent={ExperiencePreview}
      previewMilestone={{
        label: 'Preview 08',
        title: 'Product Experience & Hardening',
        note: 'Search, notification and setting changes stay local. Production integration remains gated.',
      }}
    />
  </StrictMode>,
);
