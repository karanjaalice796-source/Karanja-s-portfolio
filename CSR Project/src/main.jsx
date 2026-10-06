import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './schoolportal.css';
import './App.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.error('Offline support could not be enabled.', error);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
