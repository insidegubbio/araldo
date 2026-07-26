import { ENV } from "./env";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

export function buildGithubAuthorizeUrl(redirectUri: string, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", ENV.githubClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

type GithubTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeGithubCode(code: string, redirectUri: string): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: ENV.githubClientId,
      client_secret: ENV.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as GithubTokenResponse;
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "GitHub token exchange failed");
  }
  return data.access_token;
}

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
};

type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export async function getGithubUser(
  accessToken: string
): Promise<{ openId: string; name: string; email: string | null; login: string }> {
  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!userResponse.ok) {
    throw new Error(`GitHub user fetch failed: ${userResponse.status}`);
  }

  const user = (await userResponse.json()) as GithubUser;
  let email = user.email;

  if (!email) {
    const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as GithubEmail[];
      const primary = emails.find(e => e.primary && e.verified) ?? emails.find(e => e.verified);
      email = primary?.email ?? null;
    }
  }

  return {
    openId: `github:${user.id}`,
    name: user.name || user.login,
    email,
    login: user.login,
  };
}
