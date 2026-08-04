/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    admin: ['<rootDir>/src/stubs/admin.ts'],
    '@services/(.*)': ['<rootDir>/../src/services/$1'],
    '@services': ['<rootDir>/../src/services'],
    '@shared/(.*)': ['<rootDir>/../src/shared/$1'],
    '@shared': ['<rootDir>/../src/shared'],
  },
  testPathIgnorePatterns: ['<rootDir>/dist/'],
};
