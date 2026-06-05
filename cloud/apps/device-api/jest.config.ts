import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Config } from 'jest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: resolve(__dirname, 'tsconfig.jest.json') },
    ],
  },
  collectCoverageFrom: [
    '**/*.service.ts',
    '**/*.guard.ts',
    '**/*.controller.ts',
    '!**/*.module.ts',
    '!main.ts',
    '!**/test/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '@fancy-print/config': '<rootDir>/../../../packages/config/src',
  },
};

export default config;
