import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import '../app-shell/styles.css';
import './MessagesPreview.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="messages"
      enableMessagingPreview
      previewMilestone={{
        label: 'Preview 09',
        title: 'Basic one-to-one Messages',
        note: 'Seeded conversations only. Sending, unread state and safety actions stay in this browser; nothing reaches production.',
      }}
    />
  </StrictMode>,
);
