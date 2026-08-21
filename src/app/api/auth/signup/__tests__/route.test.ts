import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { prisma } from "@/lib/prisma";
import { jsonRequest } from "@/test/utils";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("bcryptjs", () => ({ hash: vi.fn(() => "$2a$12$hash") }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid email", async () => {
    const res = await POST(
      jsonRequest("/api/auth/signup", { name: "Test", email: "bad", password: "password123" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid email");
  });

  it("returns 400 for short password", async () => {
    const res = await POST(
      jsonRequest("/api/auth/signup", { name: "Test", email: "test@test.com", password: "123" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty name", async () => {
    const res = await POST(
      jsonRequest("/api/auth/signup", { name: "", email: "test@test.com", password: "password123" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 when email already exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "existing" } as any);
    const res = await POST(
      jsonRequest("/api/auth/signup", {
        name: "Test",
        email: "existing@test.com",
        password: "password123",
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  it("returns 201 and creates user on success", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "new-user" } as any);
    const res = await POST(
      jsonRequest("/api/auth/signup", {
        name: "Test User",
        email: "test@test.com",
        password: "password123",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("hashes password before storing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({} as any);
    await POST(
      jsonRequest("/api/auth/signup", {
        name: "Test",
        email: "test@test.com",
        password: "secret123",
      })
    );

    const createData = vi.mocked(prisma.user.create).mock.calls[0][0]?.data;
    expect(createData).toMatchObject({ name: "Test", email: "test@test.com" });
    expect((createData as any)?.passwordHash).toBe("$2a$12$hash");
  });

  it("returns 500 on unexpected error", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("DB error"));
    const res = await POST(
      jsonRequest("/api/auth/signup", {
        name: "Test",
        email: "test@test.com",
        password: "password123",
      })
    );
    expect(res.status).toBe(500);
  });
});
