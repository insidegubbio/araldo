import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./s3", () => ({
  listFiles: vi.fn().mockResolvedValue({ items: [], nextToken: undefined, isTruncated: false }),
  getUploadPresignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/upload?signed=1"),
  getDownloadPresignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/download?signed=1"),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db", () => ({
  listFilesMetadata: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  upsertFileMetadata: vi.fn().mockResolvedValue(undefined),
  getFileMetadata: vi.fn().mockResolvedValue(undefined),
  deleteFileMetadata: vi.fn().mockResolvedValue(undefined),
  incrementAccessCount: vi.fn().mockResolvedValue(undefined),
  markWorkerTracked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./worker", () => ({
  notifyWorker: vi.fn().mockResolvedValue(true),
}));

function makeCtx(role: "admin" | "user" = "user"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "oauth",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("files.list", () => {
  it("returns empty list when no files exist", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.files.list({ search: "", page: 1, pageSize: 20, prefix: "" });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("files.getUploadUrl", () => {
  it("returns a presigned upload URL", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.files.getUploadUrl({
      filename: "test.pdf",
      contentType: "application/pdf",
    });
    expect(result.uploadUrl).toContain("https://s3.example.com");
    expect(result.key).toBeTruthy();
  });
});

describe("files.getDownloadUrl", () => {
  it("returns a presigned download URL", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.files.getDownloadUrl({ key: "test/file.pdf" });
    expect(result.downloadUrl).toContain("https://s3.example.com");
  });
});

describe("files.delete", () => {
  it("allows admin to delete a file", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.files.delete({ key: "test/file.pdf" });
    expect(result.ok).toBe(true);
  });

  it("rejects non-admin delete", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    await expect(caller.files.delete({ key: "test/file.pdf" })).rejects.toThrow("Only admins");
  });
});
