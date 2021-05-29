'use strict';

module.exports = {
  globalSetup: require.resolve('./setupGlobal.js'),
  haste: {
    hasteImplModulePath: require.resolve('./noHaste.js'),
  },
  modulePathIgnorePatterns: [
    '<rootDir>/scripts/rollup/shims/',
    '<rootDir>/scripts/bench/',
  ],
  transform: {
    '.*': require.resolve('./preprocessor.js'),
  },
  setupFiles: [require.resolve('./setupEnvironment.js')],
  setupFilesAfterEnv: [require.resolve('./setupTests.js')],
  // Only include files directly in __tests__, not in nested folders.
  testRegex: '/__tests__/[^/]*(\\.js|\\.coffee|[^d]\\.ts)$',
  // testRegex: '/__tests__/ReactSuspense-test.internal(\\.js|\\.coffee|[^d]\\.ts)$',
  // testRegex: '/__tests__/ReactUpdates-test(\\.js|\\.coffee|[^d]\\.ts)$',
  // testNamePattern: 'should queue nested updates',
  // testNamePattern: 'can be toggled in and out of the markup',
  moduleFileExtensions: ['js', 'json', 'node', 'coffee', 'ts'],
  rootDir: process.cwd(),
  roots: ['<rootDir>/packages', '<rootDir>/scripts'],
  collectCoverageFrom: ['packages/**/*.js'],
  timers: 'fake',
  snapshotSerializers: [require.resolve('jest-snapshot-serializer-raw')],

  testSequencer: require.resolve('./jestSequencer'),

  testEnvironment: 'jsdom',
};
