import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { buildGithubAuthorizeUrl, exchangeGithubCode, getGithubUser } from "./github";
import { sdk } from "./sdk";

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
  app.get("/api/oauth/github/start", (req: Request, res: Response) => {
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

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
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
      const { openId, name, email } = await getGithubUser(accessToken);

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
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] GitHub callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
