import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import App from './App';
import { DataProvider } from './context/DataContext';
import { useRoute } from './lib/router';

// The admin site is a separate chunk: regular visitors never download its code.
const AdminApp = lazy(() => import('./admin/AdminApp'));

export default function Root() {
  const route = useRoute();

  if (route.name === 'admin') {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 text-emerald-600">
            <Loader2 className="w-8 h-8 animate-spin" aria-label="Loading admin" />
          </div>
        }
      >
        <AdminApp section={route.section} />
      </Suspense>
    );
  }

  return (
    <DataProvider>
      <App route={route} />
    </DataProvider>
  );
}
