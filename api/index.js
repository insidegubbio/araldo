// server/_core/app.ts
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

// drizzle/schema.ts
import { bigint, integer, pgEnum, pgTable, serial, text, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
var roleEnum = pgEnum("role", ["user", "admin"]);
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var filesMetadata = pgTable("files_metadata", {
  id: serial("id").primaryKey(),
  s3Key: varchar("s3_key", { length: 1024 }).notNull().unique(),
  filename: varchar("filename", { length: 512 }).notNull(),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  mimeType: varchar("mime_type", { length: 256 }),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  lastAccessed: timestamp("last_accessed"),
  accessCount: integer("access_count").notNull().default(0),
  workerTracked: boolean("worker_tracked").notNull().default(false)
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  workerUrl: process.env.WORKER_URL ?? "",
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  allowedGithubLogins: (process.env.ALLOWED_GITHUB_LOGINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
};

// server/db.ts
var _db = null;
async function getDb() {
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
async function upsertUser(user) {
  if (!user.openId) throw new Error("openId is required");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  for (const field of textFields) {
    const value = user[field];
    if (value === void 0) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  updateSet.updatedAt = /* @__PURE__ */ new Date();
  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
async function upsertFileMetadata(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(filesMetadata).values(data).onConflictDoUpdate({
    target: filesMetadata.s3Key,
    set: {
      filename: data.filename,
      size: data.size,
      mimeType: data.mimeType,
      uploadedBy: data.uploadedBy,
      uploadedAt: data.uploadedAt ?? /* @__PURE__ */ new Date()
    }
  });
}
async function getFileMetadata(s3Key) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(filesMetadata).where(eq(filesMetadata.s3Key, s3Key)).limit(1);
  return result[0];
}
async function listFilesMetadata(prefix = "", search = "", page = 1, pageSize = 50) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const isSearching = search.trim().length > 0;
  const conditions = [];
  if (!isSearching && prefix) conditions.push(like(filesMetadata.s3Key, `${prefix}%`));
  if (isSearching) {
    conditions.push(or(like(filesMetadata.filename, `%${search}%`), like(filesMetadata.s3Key, `%${search}%`)));
  }
  const whereClause = conditions.length ? and(...conditions) : void 0;
  const rows = await db.select().from(filesMetadata).where(whereClause).orderBy(desc(filesMetadata.uploadedAt)).limit(1e3);
  const filtered = rows.filter((row) => {
    if (row.filename === ".gitkeep") return false;
    if (isSearching) return true;
    const rest = row.s3Key.slice(prefix.length);
    return !rest.includes("/");
  });
  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  const items = filtered.slice(offset, offset + pageSize);
  return { items, total };
}
async function deleteFileMetadata(s3Key) {
  const db = await getDb();
  if (!db) return;
  await db.delete(filesMetadata).where(eq(filesMetadata.s3Key, s3Key));
}
async function incrementAccessCount(s3Key) {
  const db = await getDb();
  if (!db) return;
  await db.update(filesMetadata).set({ accessCount: sql`access_count + 1`, lastAccessed: /* @__PURE__ */ new Date() }).where(eq(filesMetadata.s3Key, s3Key));
}
async function getTopAccessedFiles(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    s3Key: filesMetadata.s3Key,
    filename: filesMetadata.filename,
    accessCount: filesMetadata.accessCount,
    lastAccessed: filesMetadata.lastAccessed
  }).from(filesMetadata).where(sql`${filesMetadata.accessCount} > 0`).orderBy(desc(filesMetadata.accessCount)).limit(limit);
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// server/_core/github.ts
var GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
var GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
var GITHUB_USER_URL = "https://api.github.com/user";
var GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
function buildGithubAuthorizeUrl(redirectUri, state) {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", ENV.githubClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}
async function exchangeGithubCode(code, redirectUri) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      client_id: ENV.githubClientId,
      client_secret: ENV.githubClientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "GitHub token exchange failed");
  }
  return data.access_token;
}
async function getGithubUser(accessToken) {
  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json"
    }
  });
  if (!userResponse.ok) {
    throw new Error(`GitHub user fetch failed: ${userResponse.status}`);
  }
  const user = await userResponse.json();
  let email = user.email;
  if (!email) {
    const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (emailsResponse.ok) {
      const emails = await emailsResponse.json();
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      email = primary?.email ?? null;
    }
  }
  return {
    openId: `github:${user.id}`,
    name: user.name || user.login,
    email,
    login: user.login
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var SDKServer = class {
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const user = await getUserByOpenId(session.openId);
    if (!user) {
      throw ForbiddenError("User not found, please log in again");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: /* @__PURE__ */ new Date()
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function getRedirectUri(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || req.protocol;
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host;
  return `${protocol}://${host}/api/oauth/callback`;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/github/start", (req, res) => {
    const nonce = crypto.randomUUID();
    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      path: "/",
      maxAge: 10 * 60 * 1e3,
      httpOnly: true,
      sameSite: "none",
      secure: true
    });
    const redirectUri = getRedirectUri(req);
    res.redirect(302, buildGithubAuthorizeUrl(redirectUri, nonce));
  });
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!expectedNonce || state !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const redirectUri = getRedirectUri(req);
      const accessToken = await exchangeGithubCode(code, redirectUri);
      const { openId, name, email, login } = await getGithubUser(accessToken);
      const isAllowed = ENV.allowedGithubLogins.length === 0 || ENV.allowedGithubLogins.includes(login.toLowerCase());
      if (!isAllowed) {
        res.redirect(302, "/login?error=not_authorized");
        return;
      }
      await upsertUser({
        openId,
        name,
        email,
        loginMethod: "github",
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] GitHub callback failed", error);
      const cause = error instanceof Error && "cause" in error ? error.cause : void 0;
      res.status(500).json({
        error: "OAuth callback failed",
        debug: error instanceof Error ? error.message : String(error),
        cause: cause instanceof Error ? cause.message : cause ? String(cause) : void 0
      });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app2) {
  app2.get("/file-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// package.json
var package_default = {
  name: "araldo",
  version: "1.1.0",
  type: "module",
  license: "GPL-3.0-only",
  scripts: {
    dev: "NODE_ENV=development tsx watch server/_core/index.ts",
    build: "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist && mkdir -p api && esbuild server/_core/vercelHandler.ts --platform=node --packages=external --bundle --format=esm --outfile=api/index.js",
    start: "NODE_ENV=production node dist/index.js",
    check: "tsc --noEmit",
    format: "prettier --write .",
    test: "vitest run",
    "db:push": "drizzle-kit generate && drizzle-kit migrate"
  },
  dependencies: {
    "@aws-sdk/client-s3": "^3.693.0",
    "@aws-sdk/s3-request-presigner": "^3.693.0",
    "@hookform/resolvers": "^5.2.2",
    "@neondatabase/serverless": "^0.10.4",
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-alert-dialog": "^1.1.15",
    "@radix-ui/react-aspect-ratio": "^1.1.7",
    "@radix-ui/react-avatar": "^1.1.10",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-context-menu": "^2.2.16",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-hover-card": "^1.1.15",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-menubar": "^1.1.16",
    "@radix-ui/react-navigation-menu": "^1.2.14",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-progress": "^1.1.7",
    "@radix-ui/react-radio-group": "^1.3.8",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.7",
    "@radix-ui/react-slider": "^1.3.6",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toggle": "^1.1.10",
    "@radix-ui/react-toggle-group": "^1.1.11",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@tanstack/react-query": "^5.90.2",
    "@trpc/client": "^11.6.0",
    "@trpc/react-query": "^11.6.0",
    "@trpc/server": "^11.6.0",
    axios: "^1.12.0",
    "class-variance-authority": "^0.7.1",
    clsx: "^2.1.1",
    cmdk: "^1.1.1",
    cookie: "^1.0.2",
    "date-fns": "^4.1.0",
    dotenv: "^17.2.2",
    "drizzle-orm": "^0.44.5",
    "embla-carousel-react": "^8.6.0",
    express: "^4.21.2",
    "framer-motion": "^12.23.22",
    "input-otp": "^1.4.2",
    jose: "6.1.0",
    "lucide-react": "^0.453.0",
    nanoid: "^5.1.5",
    "next-themes": "^0.4.6",
    react: "^19.2.1",
    "react-day-picker": "^9.11.1",
    "react-dom": "^19.2.1",
    "react-hook-form": "^7.64.0",
    "react-resizable-panels": "^3.0.6",
    recharts: "^2.15.2",
    sonner: "^2.0.7",
    streamdown: "^1.4.0",
    superjson: "^1.13.3",
    "tailwind-merge": "^3.3.1",
    "tailwindcss-animate": "^1.0.7",
    vaul: "^1.1.2",
    wouter: "^3.3.5",
    zod: "^4.1.12"
  },
  devDependencies: {
    "@builder.io/vite-plugin-jsx-loc": "^0.1.1",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "^4.1.3",
    "@types/express": "4.17.21",
    "@types/google.maps": "^3.58.1",
    "@types/node": "^24.7.0",
    "@types/react": "^19.2.1",
    "@types/react-dom": "^19.2.1",
    "@vitejs/plugin-react": "^5.0.4",
    add: "^2.0.6",
    autoprefixer: "^10.4.20",
    "drizzle-kit": "^0.31.4",
    esbuild: "^0.25.0",
    pnpm: "^10.15.1",
    postcss: "^8.4.47",
    prettier: "^3.6.2",
    tailwindcss: "^4.1.14",
    tsx: "^4.19.1",
    "tw-animate-css": "^1.4.0",
    typescript: "5.9.3",
    vite: "^7.1.7",
    vitest: "^2.1.4"
  },
  packageManager: "pnpm@10.15.1"
};

// server/version.ts
var APP_VERSION = package_default.version;

// server/s3.ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
function getClient() {
  const config2 = {
    region: ENV.s3Region,
    credentials: {
      accessKeyId: ENV.s3AccessKey,
      secretAccessKey: ENV.s3SecretKey
    },
    // newer AWS SDK v3 versions default to adding a flexible checksum to requests
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  };
  if (ENV.s3Endpoint) {
    config2.endpoint = ENV.s3Endpoint.startsWith("https://") ? ENV.s3Endpoint : `https://${ENV.s3Endpoint}`;
    config2.forcePathStyle = true;
  }
  return new S3Client(config2);
}
async function listFiles(prefix = "", maxKeys = 1e3, continuationToken) {
  const client = getClient();
  const cmd = new ListObjectsV2Command({
    Bucket: ENV.s3Bucket,
    Prefix: prefix,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
    // Group keys that share the same "folder" segment under commonprefixes
    // instead of flattening the whole subtree into Contents.
    Delimiter: "/"
  });
  const res = await client.send(cmd);
  const items = (res.Contents ?? []).map((obj) => {
    const rawName = (obj.Key ?? "").split("/").pop() ?? obj.Key ?? "";
    const displayName = rawName.replace(/^[A-Za-z0-9_-]{6,14}-/, "");
    return {
      key: obj.Key ?? "",
      filename: displayName || rawName,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? /* @__PURE__ */ new Date(),
      etag: obj.ETag?.replace(/"/g, "")
    };
  });
  const folders = (res.CommonPrefixes ?? []).map((cp) => cp.Prefix ?? "").filter(Boolean).map((p) => ({
    prefix: p,
    name: p.replace(prefix, "").replace(/\/$/, "")
  }));
  return {
    items,
    folders,
    nextToken: res.NextContinuationToken,
    isTruncated: res.IsTruncated ?? false
  };
}
async function listAllKeysUnderPrefix(prefix) {
  const client = getClient();
  const keys = [];
  let continuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: ENV.s3Bucket,
        Prefix: prefix,
        MaxKeys: 1e3,
        ContinuationToken: continuationToken
      })
    );
    (res.Contents ?? []).forEach((obj) => {
      if (obj.Key) keys.push(obj.Key);
    });
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return keys;
}
async function getUploadPresignedUrl(key, contentType, expiresIn = 3600) {
  const client = getClient();
  const cmd = new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
    ContentType: contentType
  });
  return getSignedUrl(client, cmd, { expiresIn });
}
async function configureBucketCors(allowedOrigins) {
  const client = getClient();
  const origins = allowedOrigins.length > 0 ? allowedOrigins : ["*"];
  await client.send(
    new PutBucketCorsCommand({
      Bucket: ENV.s3Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3e3
          }
        ]
      }
    })
  );
}
async function getDownloadPresignedUrl(key, expiresIn = 3600) {
  const client = getClient();
  const cmd = new GetObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key
  });
  return getSignedUrl(client, cmd, { expiresIn });
}
async function deleteFile(key) {
  const client = getClient();
  const cmd = new DeleteObjectCommand({ Bucket: ENV.s3Bucket, Key: key });
  await client.send(cmd);
}
async function calculateBucketSize() {
  const client = getClient();
  let totalSize = 0;
  let fileCount = 0;
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: ENV.s3Bucket,
      MaxKeys: 1e3,
      ContinuationToken: continuationToken
    });
    const res = await client.send(cmd);
    (res.Contents ?? []).forEach((obj) => {
      totalSize += obj.Size ?? 0;
      fileCount++;
    });
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return { totalSize, fileCount };
}
async function renameFile(oldKey, newKey) {
  const client = getClient();
  const getCmd = new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: oldKey });
  const obj = await client.send(getCmd);
  const putCmd = new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: newKey,
    Body: obj.Body,
    ContentType: obj.ContentType
  });
  await client.send(putCmd);
  await deleteFile(oldKey);
}

// server/routers/files.ts
import { PutObjectCommand as PutObjectCommand2 } from "@aws-sdk/client-s3";
import { TRPCError as TRPCError3 } from "@trpc/server";
import { nanoid } from "nanoid";
import { z as z2 } from "zod";

// server/worker.ts
async function notifyWorker(payload) {
  if (!ENV.workerUrl) return false;
  try {
    const res = await fetch(ENV.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5e3)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// server/routers/files.ts
var filesRouter = router({
  list: protectedProcedure.input(
    z2.object({
      search: z2.string().optional().default(""),
      page: z2.number().int().min(1).optional().default(1),
      pageSize: z2.number().int().min(1).max(100).optional().default(20),
      prefix: z2.string().optional().default("")
    })
  ).query(async ({ input }) => {
    const isSearching = input.search.trim().length > 0;
    const s3Prefix = isSearching ? "" : input.prefix;
    const [s3Result, dbResult] = await Promise.all([
      listFiles(s3Prefix, 1e3),
      listFilesMetadata(input.prefix, input.search, input.page, input.pageSize)
    ]);
    const s3Map = new Map(s3Result.items.map((f) => [f.key, f]));
    const enriched = dbResult.items.map((meta) => {
      const s3 = s3Map.get(meta.s3Key);
      return {
        ...meta,
        lastModified: s3?.lastModified ?? meta.uploadedAt,
        etag: s3?.etag,
        existsInS3: s3Map.has(meta.s3Key)
      };
    });
    const dbKeys = new Set(dbResult.items.map((m) => m.s3Key));
    const s3Only = s3Result.items.filter((f) => !dbKeys.has(f.key)).filter((f) => !input.search || f.filename.toLowerCase().includes(input.search.toLowerCase())).map((f) => ({
      id: -1,
      s3Key: f.key,
      filename: f.filename,
      size: f.size,
      mimeType: null,
      uploadedBy: null,
      uploadedAt: f.lastModified,
      lastAccessed: null,
      accessCount: 0,
      workerTracked: false,
      lastModified: f.lastModified,
      etag: f.etag,
      existsInS3: true
    }));
    const allItems = [...enriched, ...s3Only];
    return {
      items: allItems,
      total: dbResult.total + s3Only.length,
      page: input.page,
      pageSize: input.pageSize,
      // Subfolders of the current prefix
      folders: isSearching ? [] : s3Result.folders,
      prefix: input.prefix
    };
  }),
  getUploadUrl: protectedProcedure.input(
    z2.object({
      filename: z2.string().min(1).max(512),
      contentType: z2.string().min(1).max(256),
      folder: z2.string().optional().default("")
    })
  ).mutation(async ({ input, ctx }) => {
    const safeName = input.filename.normalize("NFKD").replace(/[^\w.\- ]/g, "").trim().slice(0, 200) || "file";
    const uniqueKey = input.folder ? `${input.folder}/${nanoid(8)}-${safeName}` : `${nanoid(8)}-${safeName}`;
    const url = await getUploadPresignedUrl(uniqueKey, input.contentType);
    await upsertFileMetadata({
      s3Key: uniqueKey,
      filename: input.filename,
      size: 0,
      mimeType: input.contentType,
      uploadedBy: ctx.user.id,
      uploadedAt: /* @__PURE__ */ new Date()
    });
    await notifyWorker({
      key: uniqueKey,
      filename: input.filename,
      action: "upload",
      userId: ctx.user.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { uploadUrl: url, key: uniqueKey };
  }),
  confirmUpload: protectedProcedure.input(z2.object({ key: z2.string(), size: z2.number().int().min(0) })).mutation(async ({ input }) => {
    const db_meta = await getFileMetadata(input.key);
    if (db_meta) {
      await upsertFileMetadata({ ...db_meta, size: input.size });
    }
    return { ok: true };
  }),
  getDownloadUrl: protectedProcedure.input(z2.object({ key: z2.string().min(1) })).mutation(async ({ input, ctx }) => {
    const url = await getDownloadPresignedUrl(input.key);
    await incrementAccessCount(input.key);
    await notifyWorker({
      key: input.key,
      filename: input.key.split("/").pop() ?? input.key,
      action: "download",
      userId: ctx.user.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { downloadUrl: url };
  }),
  delete: protectedProcedure.input(z2.object({ key: z2.string().min(1) })).mutation(async ({ input, ctx }) => {
    await deleteFile(input.key);
    await deleteFileMetadata(input.key);
    await notifyWorker({
      key: input.key,
      filename: input.key.split("/").pop() ?? input.key,
      action: "delete",
      userId: ctx.user.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { ok: true };
  }),
  deleteMany: protectedProcedure.input(z2.object({ keys: z2.array(z2.string().min(1)).min(1).max(500) })).mutation(async ({ input, ctx }) => {
    const results = await Promise.allSettled(
      input.keys.map(async (key) => {
        await deleteFile(key);
        await deleteFileMetadata(key);
        await notifyWorker({
          key,
          filename: key.split("/").pop() ?? key,
          action: "delete",
          userId: ctx.user.id,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      })
    );
    const deleted = results.filter((r) => r.status === "fulfilled").length;
    const failed = input.keys.filter((_, i) => results[i].status === "rejected");
    return { deleted, failed };
  }),
  workerStatus: publicProcedure.query(() => {
    return { enabled: Boolean(ENV.workerUrl), url: ENV.workerUrl ? "configured" : null };
  }),
  configureCors: protectedProcedure.mutation(async () => {
    if (!ENV.s3Bucket) {
      throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "S3_BUCKET non \xE8 configurato" });
    }
    const origins = ENV.corsAllowedOrigins.length > 0 ? ENV.corsAllowedOrigins : ["*"];
    await configureBucketCors(origins);
    return { origins };
  }),
  mkdir: protectedProcedure.input(z2.object({ folderName: z2.string().min(1).max(256), prefix: z2.string().optional().default("") })).mutation(async ({ input }) => {
    const safeName = input.folderName.trim().replace(/\/+/g, "");
    if (!safeName) {
      throw new Error("Nome cartella non valido");
    }
    const key = `${input.prefix}${safeName}/.gitkeep`;
    const client = getClient();
    await client.send(new PutObjectCommand2({
      Bucket: ENV.s3Bucket,
      Key: key,
      Body: Buffer.from("")
    }));
    await upsertFileMetadata({
      s3Key: key,
      filename: ".gitkeep",
      size: 0,
      mimeType: "application/octet-stream",
      uploadedBy: null,
      uploadedAt: /* @__PURE__ */ new Date()
    });
    return { ok: true, key };
  }),
  rename: protectedProcedure.input(z2.object({ oldKey: z2.string().min(1), newName: z2.string().min(1).max(512) })).mutation(async ({ input, ctx }) => {
    const newKey = input.oldKey.includes("/") ? input.oldKey.split("/").slice(0, -1).join("/") + "/" + input.newName : input.newName;
    const oldMeta = await getFileMetadata(input.oldKey);
    await renameFile(input.oldKey, newKey);
    await deleteFileMetadata(input.oldKey);
    await upsertFileMetadata({
      s3Key: newKey,
      filename: input.newName,
      size: oldMeta?.size ?? 0,
      mimeType: oldMeta?.mimeType ?? null,
      uploadedBy: oldMeta?.uploadedBy ?? ctx.user.id,
      uploadedAt: oldMeta?.uploadedAt ?? /* @__PURE__ */ new Date()
    });
    await notifyWorker({
      key: newKey,
      filename: input.newName,
      action: "download",
      userId: ctx.user.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { ok: true, newKey };
  }),
  deleteFolder: protectedProcedure.input(z2.object({ prefix: z2.string().min(1) })).mutation(async ({ input, ctx }) => {
    const normalizedPrefix = input.prefix.endsWith("/") ? input.prefix : `${input.prefix}/`;
    const keys = await listAllKeysUnderPrefix(normalizedPrefix);
    await Promise.allSettled(
      keys.map(async (key) => {
        await deleteFile(key);
        await deleteFileMetadata(key);
      })
    );
    await notifyWorker({
      key: normalizedPrefix,
      filename: normalizedPrefix.replace(/\/$/, "").split("/").pop() ?? normalizedPrefix,
      action: "delete",
      userId: ctx.user.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { ok: true, deleted: keys.length };
  }),
  renameFolder: protectedProcedure.input(z2.object({ oldPrefix: z2.string().min(1), newName: z2.string().min(1).max(256) })).mutation(async ({ input, ctx }) => {
    const safeName = input.newName.trim().replace(/\/+/g, "");
    if (!safeName) {
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Nome cartella non valido" });
    }
    const normalizedOld = input.oldPrefix.endsWith("/") ? input.oldPrefix : `${input.oldPrefix}/`;
    const parent = normalizedOld.split("/").slice(0, -2).join("/");
    const normalizedNew = parent ? `${parent}/${safeName}/` : `${safeName}/`;
    if (normalizedNew === normalizedOld) {
      return { ok: true, newPrefix: normalizedNew };
    }
    const keys = await listAllKeysUnderPrefix(normalizedOld);
    for (const oldKey of keys) {
      const newKey = normalizedNew + oldKey.slice(normalizedOld.length);
      const oldMeta = await getFileMetadata(oldKey);
      await renameFile(oldKey, newKey);
      await deleteFileMetadata(oldKey);
      await upsertFileMetadata({
        s3Key: newKey,
        filename: oldMeta?.filename ?? newKey.split("/").pop() ?? newKey,
        size: oldMeta?.size ?? 0,
        mimeType: oldMeta?.mimeType ?? null,
        uploadedBy: oldMeta?.uploadedBy ?? ctx.user.id,
        uploadedAt: oldMeta?.uploadedAt ?? /* @__PURE__ */ new Date()
      });
    }
    await notifyWorker({
      key: normalizedNew,
      filename: safeName,
      action: "upload",
      userId: ctx.user.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { ok: true, newPrefix: normalizedNew };
  }),
  storageStats: protectedProcedure.query(async () => {
    const { totalSize, fileCount } = await calculateBucketSize();
    return {
      totalSize,
      fileCount,
      totalSizeGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2)
    };
  }),
  topAccessed: protectedProcedure.input(z2.object({ limit: z2.number().int().min(1).max(50).optional().default(10) })).query(async ({ input }) => {
    return getTopAccessedFiles(input.limit);
  }),
  settings: publicProcedure.query(() => {
    return {
      bucket: ENV.s3Bucket,
      region: ENV.s3Region,
      endpoint: ENV.s3Endpoint,
      workerUrl: ENV.workerUrl ? "configured" : null,
      version: APP_VERSION
    };
  })
});

// server/routers.ts
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  files: filesRouter
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/app.ts
function createApp() {
  const app2 = express();
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app2);
  registerOAuthRoutes(app2);
  app2.post("/share-target", express.urlencoded({ extended: true }), (_req, res) => {
    res.redirect(303, "/#/share-receive");
  });
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app2;
}

// server/_core/vercelHandler.ts
var config = {
  maxDuration: 30
};
var app = createApp();
function handler(req, res) {
  return app(req, res);
}
export {
  config,
  handler as default
};
