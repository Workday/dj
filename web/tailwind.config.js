import containerQueries from '@tailwindcss/container-queries';
import { defaultTheme } from './tailwind.defaults';

const colors = {
  background: 'var(--color-background)',
  'background-contrast': 'var(--color-background-contrast)',
  surface: 'var(--color-surface)',
  'surface-contrast': 'var(--color-surface-contrast)',
  card: 'var(--color-card)',
  primary: 'var(--color-primary)',
  'primary-contrast': 'var(--color-primary-contrast)',
  secondary: 'var(--color-secondary)',
  'secondary-contrast': 'var(--color-secondary-contrast)',
  success: 'var(--color-success)',
  'success-contrast': 'var(--color-success-contrast)',
  error: 'var(--color-error)',
  'error-contrast': 'var(--color-error-contrast)',
  info: 'var(--color-info)',
  'info-contrast': 'var(--color-info-contrast)',
  warning: 'var(--color-warning)',
};

const bgColors = {
  'message-info': 'var(--color-message-info)',
  'message-error': 'var(--color-message-error)',
  'message-warning': 'var(--color-message-warning)',
  'message-success': 'var(--color-message-success)',
  'switch-on': 'var(--color-switch-on)',
  'switch-off': 'var(--color-switch-off)',
  tag: 'var(--color-tag)',
  'tab-contrast': 'var(--color-tab-contrast)',
  'list-item-hover': 'var(--color-list-item-hover)',
};

const textColors = {
  'message-info-contrast': 'var(--color-message-info-contrast)',
  'message-error-contrast': 'var(--color-message-error-contrast)',
  'message-warning-contrast': 'var(--color-message-warning-contrast)',
  'message-success-contrast': 'var(--color-message-success-contrast)',
  'tag-contrast': 'var(--color-tag-contrast)',
};

const borderColors = {
  'message-info': 'var(--color-message-info-border)',
  'message-error': 'var(--color-message-error-border)',
  'message-warning': 'var(--color-message-warning-border)',
  'message-success': 'var(--color-message-success-border)',
  neutral: 'var(--color-border)',
  'neutral-contrast': 'var(--color-border-contrast)',
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [],
  darkMode: 'class', // or 'class'
  plugins: ['@tailwindcss/forms', containerQueries],
  theme: {
    ...defaultTheme,
    extend: {
      backgroundColor: {
        ...colors,
        ...bgColors,
      },
      colors,
      textColor: {
        DEFAULT: colors['background-contrast'],
        foreground: colors['background-contrast'],
        'muted-foreground': colors['background-contrast'],
        ...colors,
        ...textColors,
      },
      ringColor: {
        DEFAULT: colors['background-contrast'],
        ...colors,
      },
      borderColor: {
        ...borderColors,
      },
      fontSize: {
        tiny: '0.625rem', // 10px
      },
    },
  },
};
