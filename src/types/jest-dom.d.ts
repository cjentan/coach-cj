// Make @testing-library/jest-dom matchers (toBeInTheDocument, toBeDisabled, ...)
// type-check on vitest's Assertion interface.
//
// src/test/setup.ts already imports "@testing-library/jest-dom/vitest" at runtime,
// but src/test is excluded from tsconfig, so the module augmentation never loads
// for tsc. Importing it from a file inside the tsconfig include makes the types
// visible everywhere.
import "@testing-library/jest-dom/vitest";
