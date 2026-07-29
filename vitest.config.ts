import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.e2e.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      exclude: [
        'src/test/**',
        'src/**/*.test.*',
        'src/**/*.d.ts',
        'src/.next/**',
        'src/**/*.tsx',
      ],
      thresholds: {
        statements: 10,
        branches: 10,
        functions: 15,
        lines: 10,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // next-auth imports next/server without extension — make it resolvable
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
      'next/server.js': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
});
