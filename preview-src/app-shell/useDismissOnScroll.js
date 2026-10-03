import { useEffect } from 'react';

export function useDismissOnScroll(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = () => onClose();
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('scroll', dismiss, { passive: true });
    document.addEventListener('touchmove', dismiss, { capture: true, passive: true });
    document.addEventListener('wheel', dismiss, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('scroll', dismiss);
      document.removeEventListener('touchmove', dismiss, true);
      document.removeEventListener('wheel', dismiss, true);
    };
  }, [open, onClose]);
}
