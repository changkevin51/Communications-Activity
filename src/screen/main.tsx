import { createRoot } from 'react-dom/client';
import '@fontsource-variable/anybody/wdth.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './screen.css';
import { ScreenApp } from './ScreenApp';

createRoot(document.getElementById('root')!).render(<ScreenApp />);
