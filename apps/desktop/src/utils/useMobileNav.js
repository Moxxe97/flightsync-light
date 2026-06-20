// src/utils/useMobileNav.js
import { useState, useEffect, useCallback } from 'react';

// null = show the home menu; a section id = show that section.
export function useMobileNav() {
  const [section, setSection] = useState(null);

  const open = useCallback((id) => {
    setSection(id);
    window.history.pushState({ section: id }, '');
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  useEffect(() => {
    const onPop = () => setSection(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return { section, open, back };
}
