import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import vs from 'react-syntax-highlighter/dist/esm/styles/hljs/vs';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/hljs/vs2015';

// Register only the languages we need
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('yaml', yaml);

export interface CodeBlockProps {
  code: string;
  language: 'json' | 'yaml' | 'sql' | 'bash';
  theme: 'light' | 'dark';
  className?: string;
  wrapLines?: boolean;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  code,
  language,
  theme,
  className = '',
  wrapLines = false,
  showLineNumbers = false,
}: CodeBlockProps) {
  const baseStyle = theme === 'dark' ? vscDarkPlus : vs;

  // Customize style to ensure consistent background
  const customStyle = {
    ...baseStyle,
    hljs: {
      ...baseStyle.hljs,
      padding: '1rem',
      margin: 0,
      overflow: 'auto',
    },
  };

  // The `dj-code-block` class anchors a global CSS override in
  // `web/src/main.css` that neutralizes the VS Code webview's default
  // `<code>` styling (background, padding, border-radius, border).
  // Without it those defaults paint a per-line tint over the highlighted
  // tokens and produce the "striped lines" artifact in both light and
  // dark themes. Keeping this class on every CodeBlock means consumers
  // don't need to remember to wrap with `.live-preview` /
  // `.final-preview` / `.compiled-sql-preview` etc. to get clean output.
  const wrapperClassName = `dj-code-block ${className}`.trim();

  return (
    <SyntaxHighlighter
      language={language}
      style={customStyle}
      className={wrapperClassName}
      wrapLines={wrapLines}
      wrapLongLines={wrapLines}
      showLineNumbers={showLineNumbers}
      lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', opacity: 0.5 }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
