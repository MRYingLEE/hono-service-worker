/* eslint-env node, es2020 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: '<rootDir>/jest.environment.js',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts']
};
