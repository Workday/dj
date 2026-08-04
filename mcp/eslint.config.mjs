/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'vscode', message: 'MCP server must not import vscode' },
          { name: '@services/config', message: 'Use headless DJ config instead' },
          { name: '@services/dbt', message: 'Use @services/framework/headless loadDbtProject' },
        ],
      },
    ],
  },
};
