import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import IdentityPreview from './IdentityPreview.jsx';
import '../app-shell/styles.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <IdentityPreview />
  </StrictMode>,
);
