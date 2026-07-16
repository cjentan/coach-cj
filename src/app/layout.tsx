import { ReactNode } from "react";

// Thin root layout — next-intl handles locale in [locale]/layout.tsx
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
