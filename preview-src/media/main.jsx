import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import '../app-shell/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="stream"
      enableStreamLab
      enableMediaPreview
      previewMilestone={{
        label: 'Preview 05',
        title: 'Media & R2',
        note: 'Seeded media only. Validation, progress and recovery are simulated locally; no file reaches R2 or production.',
      }}
    />
  </StrictMode>,
);
