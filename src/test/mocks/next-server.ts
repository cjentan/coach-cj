/**
 * Mock for `next/server` to use in API route tests.
 *
 * Vitest can't resolve next/server in Node environment because
 * Next.js uses ESM without .js extensions.
 *
 * Usage in test files:
 *   import '@/test/mocks/next-server';
 *
 * This must be imported BEFORE any imports from next/server
 * (or modules that import from next/server).
 */

// @ts-expect-error - we need to mock before module resolution
const { vi } = await import("vitest");

export const mockNextServer = () => {
  vi.mock("next/server", () => ({
    NextResponse: {
      json: vi.fn((body?: unknown, init?: ResponseInit) => {
        const status = (init?.status as number) ?? 200;
        return {
          status,
          json: async () => body,
          headers: new Headers(init?.headers),
          ok: status >= 200 && status < 300,
        } as Response;
      }),
    },
    NextRequest: class MockNextRequest {
      readonly url: string;
      readonly method: string;
      readonly headers: Headers;
      readonly body: ReadableStream | null;
      nextUrl: URL;

      constructor(input: string | URL, init?: RequestInit) {
        this.url = input.toString();
        this.method = init?.method ?? "GET";
        this.headers = new Headers(init?.headers);
        this.body = init?.body as ReadableStream | null;
        this.nextUrl = new URL(this.url, "http://localhost:3000");
      }

      async json() {
        if (typeof this.body === "string") return JSON.parse(this.body);
        return {};
      }

      async arrayBuffer() {
        return new ArrayBuffer(0);
      }
    },
  }));
};
