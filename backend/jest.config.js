export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@jump/db$': '<rootDir>/../packages/db/src/index.js',
  },
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js', '!src/database/seeds/**'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
};
