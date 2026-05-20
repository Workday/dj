import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

function readThemeFromDom(): ThemeMode {
  if (typeof document === 'undefined') {
    return 'light';
  }
  const value = document.documentElement.getAttribute('data-theme');
  return value?.includes('dark') ? 'dark' : 'light';
}

/**
 * Reactively tracks VS Code's webview theme by observing the
 * `<html data-theme="…">` attribute, returning `'light'` or `'dark'`.
 *
 * Components that render syntax-highlighted code or other theme-aware
 * surfaces should consume this so their styling matches the editor
 * theme even when the user toggles between light/dark at runtime.
 */
export function useThemeMode(): ThemeMode {
  const [theme, setTheme] = useState<ThemeMode>(() => readThemeFromDom());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          setTheme(readThemeFromDom());
          break;
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
