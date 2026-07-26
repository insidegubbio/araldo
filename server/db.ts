import { desc, eq, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { filesMetadata, InsertFileMetadata, InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[db] failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("openId is required");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  updateSet.updatedAt = new Date();
  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function upsertFileMetadata(data: InsertFileMetadata) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(filesMetadata)
    .values(data)
    .onConflictDoUpdate({
      target: filesMetadata.s3Key,
      set: {
        filename: data.filename,
        size: data.size,
        mimeType: data.mimeType,
        uploadedBy: data.uploadedBy,
        uploadedAt: data.uploadedAt ?? new Date(),
      },
    });
}

export async function getFileMetadata(s3Key: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(filesMetadata).where(eq(filesMetadata.s3Key, s3Key)).limit(1);
  return result[0];
}

export async function listFilesMetadata(search = "", page = 1, pageSize = 50) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const offset = (page - 1) * pageSize;
  const whereClause = search
    ? or(like(filesMetadata.filename, `%${search}%`), like(filesMetadata.s3Key, `%${search}%`))
    : undefined;
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(filesMetadata)
      .where(whereClause)
      .orderBy(desc(filesMetadata.uploadedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(filesMetadata)
      .where(whereClause),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function deleteFileMetadata(s3Key: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(filesMetadata).where(eq(filesMetadata.s3Key, s3Key));
}

export async function incrementAccessCount(s3Key: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(filesMetadata)
    .set({ accessCount: sql`access_count + 1`, lastAccessed: new Date() })
    .where(eq(filesMetadata.s3Key, s3Key));
}

export async function markWorkerTracked(s3Key: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(filesMetadata).set({ workerTracked: true }).where(eq(filesMetadata.s3Key, s3Key));
}
