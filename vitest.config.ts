import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Disable oxc so esbuild handles JSX/TSX transforms
  oxc: false,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.e2e.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    deps: {
      optimizer: {
        web: {
          enabled: false,
        },
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**'],
      exclude: [
        'src/test/**',
        'src/**/*.test.*',
        'src/**/*.d.ts',
        'src/.next/**',
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
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
      'next/server.js': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
});
