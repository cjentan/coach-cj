import { NextRequest } from "next/server";

/**
 * Create a NextRequest for testing a route handler.
 */
export function createRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options as any);
}

/**
 * Create a POST NextRequest with a JSON body.
 */
export function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Create a GET NextRequest with query parameters.
 */
export function queryRequest(url: string, params: Record<string, string>): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(new URL(`${url}?${searchParams.toString()}`, "http://localhost:3000"));
}
