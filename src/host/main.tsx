import { createRoot } from 'react-dom/client';
import './host.css';
import { HostApp } from './HostApp';

createRoot(document.getElementById('root')!).render(<HostApp />);
