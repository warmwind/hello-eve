import { extractBearerToken, type AuthFn } from "eve/channels/auth";

const DEFAULT_ISSUER = "https://account.jinshuju.net";
const STANDARD_CLAIMS = new Set(["aud", "exp", "iat", "iss", "jti", "nbf", "sub"]);

export interface JinshujuOidcOptions {
  readonly issuer?: string;
}

export function jinshujuOidc(options: JinshujuOidcOptions = {}): AuthFn<Request> {
  const issuer = (options.issuer ?? DEFAULT_ISSUER).replace(/\/+$/, "");
  const userInfoEndpoint = `${issuer}/oauth/userinfo`;

  return async (request) => {
    const accessToken = extractBearerToken(request.headers.get("authorization"));
    if (accessToken === null) return null;

    let response: Response;
    try {
      response = await fetch(userInfoEndpoint, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;

    let userInfo: unknown;
    try {
      userInfo = await response.json();
    } catch {
      return null;
    }
    if (!isRecord(userInfo) || typeof userInfo.sub !== "string" || !userInfo.sub) return null;

    const subject = userInfo.sub;
    return {
      attributes: userInfoAttributes(userInfo),
      authenticator: "oidc",
      issuer,
      principalId: `${issuer}:${subject}`,
      principalType: "user",
      subject,
    };
  };
}

function userInfoAttributes(userInfo: Record<string, unknown>): Record<string, string | readonly string[]> {
  return Object.fromEntries(
    Object.entries(userInfo).filter(
      ([key, value]) =>
        !STANDARD_CLAIMS.has(key) &&
        (typeof value === "string" ||
          (Array.isArray(value) && value.every((item) => typeof item === "string"))),
    ),
  ) as Record<string, string | readonly string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
