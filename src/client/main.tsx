import { createRoot } from 'react-dom/client';
import '@fontsource-variable/anybody/wdth.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/global.css';
import './styles/board.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <>
    <div className="grain" aria-hidden="true" />
    <App />
  </>,
);
