import '@fontsource-variable/martian-mono/standard.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initialLang } from './i18n';
import { set } from './state/store';

const lang = initialLang();
set({ lang });
document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
