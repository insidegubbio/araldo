import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { buildGithubAuthorizeUrl, exchangeGithubCode, getGithubUser } from "./github";
import { sdk } from "./sdk";

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getRedirectUri(req: Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || req.protocol;
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host;
  return `${protocol}://${host}/api/oauth/callback`;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/github/start", oauthLimiter, (req: Request, res: Response) => {
    const nonce = crypto.randomUUID();
    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      path: "/",
      maxAge: 10 * 60 * 1000,
      httpOnly: true,
      sameSite: "none",
      secure: true,
    });
    const redirectUri = getRedirectUri(req);
    res.redirect(302, buildGithubAuthorizeUrl(redirectUri, nonce));
  });

  app.get("/api/oauth/callback", oauthLimiter, async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!expectedNonce || state !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    try {
      const redirectUri = getRedirectUri(req);
      const accessToken = await exchangeGithubCode(code, redirectUri);
      const { openId, name, email, login } = await getGithubUser(accessToken);

      const isAllowed =
        ENV.allowedGithubLogins.length === 0 ||
        ENV.allowedGithubLogins.includes(login.toLowerCase());

      if (!isAllowed) {
        res.redirect(302, "/login?error=not_authorized");
        return;
      }

      await db.upsertUser({
        openId,
        name,
        email,
        loginMethod: "github",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        path: cookieOptions.path,
        sameSite: cookieOptions.sameSite,
        maxAge: ONE_YEAR_MS,
        httpOnly: true,
        secure: true,
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] GitHub callback failed", error);
      const cause = error instanceof Error && "cause" in error ? (error as any).cause : undefined;
      res.status(500).json({
        error: "OAuth callback failed",
        debug: error instanceof Error ? error.message : String(error),
        cause: cause instanceof Error ? cause.message : cause ? String(cause) : undefined,
      });
    }
  });
}
