import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../app-shell/App.jsx';
import SettingsPreview from './SettingsPreview.jsx';
import '../app-shell/styles.css';
import './SettingsPreview.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App
      initialSection="settings"
      enableSettingsPreview
      settingsComponent={SettingsPreview}
      previewMilestone={{
        label: 'Preview 10',
        title: 'Settings, Privacy & Account Controls',
        note: 'Seeded preferences only. Session, export and deletion actions stay in this browser; no account or production data is changed.',
      }}
    />
  </StrictMode>,
);
