import { useEffect, useRef } from 'react';

// Every open dialog registers itself here, in the order it opened.
const openModals: symbol[] = [];

/**
 * Shared modal behaviour, safe for dialogs stacked on top of each other:
 *  - Escape closes only the TOP-most dialog (not all of them at once),
 *  - the page behind stops scrolling until the LAST dialog has closed.
 * Call it once inside any modal component.
 */
export function useModal(onClose: () => void): void {
  // Always call the latest onClose without re-registering the dialog on every render.
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    const id = Symbol('modal');
    openModals.push(id);
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === id) latestClose.current();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openModals.indexOf(id);
      if (at >= 0) openModals.splice(at, 1);
      if (openModals.length === 0) document.body.style.overflow = '';
    };
  }, []);
}
