import { useEffect, useState } from 'react';

/**
 * Tiny hash router (#/about, #/contact, #/admin/…). Hash routes work on any
 * static host without server rewrites, and the admin area stays out of the
 * server logs / search-engine index.
 */
export type Route =
  | { name: 'home' }
  | { name: 'marketplace' }
  | { name: 'about' }
  | { name: 'contact' }
  | { name: 'admin'; section: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'marketplace':
      return { name: 'marketplace' };
    case 'about':
      return { name: 'about' };
    case 'contact':
      return { name: 'contact' };
    case 'admin':
      return { name: 'admin', section: parts[1] || 'dashboard' };
    default:
      return { name: 'home' };
  }
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
