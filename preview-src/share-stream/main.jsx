import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import '../app-shell/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="stream"
      enableStreamLab
      previewMilestone={{
        label: 'Preview 04',
        title: 'Create Post & Feed',
        note: 'Seeded local interactions only. Drafts, new posts and Feed states never leave this device.',
      }}
    />
  </StrictMode>,
);
