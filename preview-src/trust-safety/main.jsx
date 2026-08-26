import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import SafetyPreview from '../app-shell/SafetyPreview.jsx';
import '../app-shell/styles.css';
import './SafetyPreview.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="safety"
      enableSafetyPreview
      safetyComponent={SafetyPreview}
      previewMilestone={{
        label: 'Preview 07',
        title: 'Trust, Safety & Admin Operations',
        note: 'Seeded cases only. Reports, appeals and admin actions stay in this browser; no moderation action reaches production.',
      }}
    />
  </StrictMode>,
);
