import { bigint, integer, pgEnum, pgTable, serial, text, timestamp, varchar, boolean } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const filesMetadata = pgTable("files_metadata", {
  id: serial("id").primaryKey(),
  s3Key: varchar("s3_key", { length: 1024 }).notNull().unique(),
  filename: varchar("filename", { length: 512 }).notNull(),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  mimeType: varchar("mime_type", { length: 256 }),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  lastAccessed: timestamp("last_accessed"),
  accessCount: integer("access_count").notNull().default(0),
  workerTracked: boolean("worker_tracked").notNull().default(false),
});

export type FileMetadata = typeof filesMetadata.$inferSelect;
export type InsertFileMetadata = typeof filesMetadata.$inferInsert;
