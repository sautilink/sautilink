import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import '../app-shell/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="thread"
      enableStreamLab
      enableMediaPreview
      enableConversationPreview
      previewMilestone={{
        label: 'Preview 06',
        title: 'Conversations & Threads',
        note: 'Seeded replies only. Thread actions, delivery recovery and safety states stay on this device; nothing reaches production.',
      }}
    />
  </StrictMode>,
);
