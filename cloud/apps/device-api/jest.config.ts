import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: [
    '**/*.service.ts',
    '**/*.guard.ts',
    '**/*.controller.ts',
    '!**/*.module.ts',
    '!main.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '@fancy-print/config': '<rootDir>/../../../packages/config/src',
  },
};

export default config;
