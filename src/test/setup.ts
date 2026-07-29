import '@testing-library/jest-dom/vitest';

// Set test environment variables that lib modules expect
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5433/coach_test';
(process.env as Record<string, string>).NODE_ENV = 'test';
