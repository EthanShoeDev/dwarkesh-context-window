import { ScriptOnce } from '@tanstack/react-router';
import { createClientOnlyFn, createIsomorphicFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const getStoredTheme = createIsomorphicFn()
  .server((_storageKey: string, defaultTheme: Theme): Theme => defaultTheme)
  .client((storageKey: string, defaultTheme: Theme): Theme => {
    try {
      const storedTheme = localStorage.getItem(storageKey) as Theme | null;
      return storedTheme || defaultTheme;
    } catch {
      return defaultTheme;
    }
  });

const setStoredTheme = createClientOnlyFn((storageKey: string, theme: Theme) => {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // ignore
  }
});

const resolveSystemTheme = createIsomorphicFn()
  .server((): Exclude<Theme, 'system'> => 'light')
  .client((): Exclude<Theme, 'system'> => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme(storageKey, defaultTheme));

  const themeDetectorScript = useMemo(() => {
    // Run before hydration to prevent light<->dark flash.
    const key = JSON.stringify(storageKey);
    const fallback = JSON.stringify(defaultTheme);
    return `(function () {
  try {
    var storageKey = ${key};
    var defaultTheme = ${fallback};
    var theme = localStorage.getItem(storageKey) || defaultTheme;
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      var systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      return;
    }
    if (theme === 'light' || theme === 'dark') {
      root.classList.add(theme);
      return;
    }
    if (defaultTheme === 'system') {
      var systemTheme2 = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme2);
      return;
    }
    root.classList.add(defaultTheme);
  } catch (e) {}
})();`;
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const apply = () => {
        const systemTheme = resolveSystemTheme();
        root.classList.remove('light', 'dark');
        root.classList.add(systemTheme);
      };
      apply();

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', apply);
      return () => mediaQuery.removeEventListener('change', apply);
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      setStoredTheme(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      <ScriptOnce children={themeDetectorScript} />
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
