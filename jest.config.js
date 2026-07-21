/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  moduleNameMapper: {
    admin: ['<rootDir>/src/admin'],
    '@services/(.*)': ['<rootDir>/src/services/$1'],
    '@services': ['<rootDir>/src/services'],
    '@shared/(.*)': ['<rootDir>/src/shared/$1'],
    '@shared': ['<rootDir>/src/shared'],
    '@web/(.*)': ['<rootDir>/web/src/$1'],
    '@web': ['<rootDir>/web/src'],
  },
  // Transpile-only mode lives in tsconfig.json (`isolatedModules: true`) so
  // ts-jest picks it up without the deprecated transform option. That keeps
  // cross-package type resolution (e.g. the web tree's DOM globals and
  // `@web/*` paths) from needing to be wired into the root tsconfig.
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testPathIgnorePatterns: [
    '<rootDir>/out/',
    '<rootDir>/dist/',
    '<rootDir>/venv/',
    '<rootDir>/.venv/',
    '/__tests__/helpers\\.ts$',
  ],
};

module.exports = config;
