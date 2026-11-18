import { createRoot } from 'react-dom/client';
import Root from './Root';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </ErrorBoundary>
);
