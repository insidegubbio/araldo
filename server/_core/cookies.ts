import type { CookieOptions, Request } from "express";

// session cookies options
export function getSessionCookieOptions(
  _req: Request
): Pick<CookieOptions, "httpOnly" | "path" | "sameSite" | "secure"> {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: true,
  };
}
