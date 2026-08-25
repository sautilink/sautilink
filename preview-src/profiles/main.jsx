import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import '../app-shell/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="profile"
      previewMilestone={{
        label: 'Preview 03',
        title: 'Profiles & Circles',
        note: 'Seeded interactions only. Public/private data boundaries stay intact and production is untouched.',
      }}
    />
  </StrictMode>,
);
