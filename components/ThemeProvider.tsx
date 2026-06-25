'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

type ThemeContextType = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggle: () => {},
  setTheme: () => {},
});

function applyClass(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  // Sync React state with the class set by the no-FOUC script in <head>.
  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    const initial =
      stored ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    // One-time sync of React state with the class set by the pre-paint script.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(initial);
    applyClass(initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyClass(t);
    try {
      localStorage.setItem('theme', t);
    } catch {
      /* ignore (private mode) */
    }
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

/** Inline script that sets the theme class before first paint (avoids flash). */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`;
