CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "files_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"s3_key" varchar(1024) NOT NULL,
	"filename" varchar(512) NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"mime_type" varchar(256),
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"last_accessed" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL,
	"worker_tracked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "files_metadata_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
