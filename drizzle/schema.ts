import { bigint, int, mysqlEnum, mysqlTable, text, timestamp, tinyint, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const filesMetadata = mysqlTable("files_metadata", {
  id: int("id").autoincrement().primaryKey(),
  s3Key: varchar("s3_key", { length: 1024 }).notNull().unique(),
  filename: varchar("filename", { length: 512 }).notNull(),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  mimeType: varchar("mime_type", { length: 256 }),
  uploadedBy: int("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  lastAccessed: timestamp("last_accessed"),
  accessCount: int("access_count").notNull().default(0),
  workerTracked: tinyint("worker_tracked").notNull().default(0),
});

export type FileMetadata = typeof filesMetadata.$inferSelect;
export type InsertFileMetadata = typeof filesMetadata.$inferInsert;
