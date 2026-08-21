import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../detect/route";
import { auth } from "@/lib/auth";
import { createRequest, jsonRequest } from "@/test/utils";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/duplicate-detector", () => ({
  detectDuplicates: vi.fn(),
  persistDuplicateGroups: vi.fn(),
}));

import { detectDuplicates, persistDuplicateGroups } from "@/lib/duplicate-detector";

describe("POST /api/duplicates/detect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await POST(createRequest("/api/duplicates/detect"));
    expect(res.status).toBe(401);
  });

  it("runs detection without persisting by default", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(detectDuplicates).mockResolvedValue({
      groups: [{ id: "g1" }],
      stats: { scanned: 10, candidates: 2, groups: 1 },
    } as any);

    const res = await POST(createRequest("/api/duplicates/detect"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.persisted).toBe(0);
    expect(body.message).toContain("dry run");
    expect(persistDuplicateGroups).not.toHaveBeenCalled();
  });

  it("persists groups when ?persist=true", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(detectDuplicates).mockResolvedValue({
      groups: [{ id: "g1" }],
      stats: { scanned: 10, candidates: 2, groups: 1 },
    } as any);
    vi.mocked(persistDuplicateGroups).mockResolvedValue(1);

    const res = await POST(createRequest("/api/duplicates/detect?persist=true"));
    const body = await res.json();
    expect(body.persisted).toBe(1);
    expect(body.message).toContain("saved");
    expect(persistDuplicateGroups).toHaveBeenCalled();
  });

  it("handles empty results", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(detectDuplicates).mockResolvedValue({
      groups: [],
      stats: { scanned: 5, candidates: 0, groups: 0 },
    });

    const res = await POST(createRequest("/api/duplicates/detect"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toHaveLength(0);
  });

  it("returns 500 on detection error", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(detectDuplicates).mockRejectedValue(new Error("Scan failed"));

    const res = await POST(createRequest("/api/duplicates/detect"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Scan failed");
  });
});
