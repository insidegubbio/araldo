import { and, desc, eq, like, or, sql } from "drizzle-orm";
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

export async function listFilesMetadata(prefix = "", search = "", page = 1, pageSize = 50) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  //a search query looks across the whole bucket, not just the current folder
  const isSearching = search.trim().length > 0;
  const conditions = [];
  if (!isSearching && prefix) conditions.push(like(filesMetadata.s3Key, `${prefix}%`));
  if (isSearching) {
    conditions.push(or(like(filesMetadata.filename, `%${search}%`), like(filesMetadata.s3Key, `%${search}%`)));
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  // fetch broadly and filter/paginate in js
  const rows = await db
    .select()
    .from(filesMetadata)
    .where(whereClause)
    .orderBy(desc(filesMetadata.uploadedAt))
    .limit(1000);

  const filtered = rows.filter((row) => {
    if (row.filename === ".gitkeep") return false; // folder placeholder, not a real file
    if (isSearching) return true; // search matches anywhere in the bucket
    const rest = row.s3Key.slice(prefix.length);
    return !rest.includes("/"); // only direct children of the current folder
  });

  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  const items = filtered.slice(offset, offset + pageSize);
  return { items, total };
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

export async function getTopAccessedFiles(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      s3Key: filesMetadata.s3Key,
      filename: filesMetadata.filename,
      accessCount: filesMetadata.accessCount,
      lastAccessed: filesMetadata.lastAccessed,
    })
    .from(filesMetadata)
    .where(sql`${filesMetadata.accessCount} > 0`)
    .orderBy(desc(filesMetadata.accessCount))
    .limit(limit);
}
