import { createRemoteJWKSet, jwtVerify } from "jose";

const remoteKeySets = new Map();
const OWNER_SESSION_COOKIE = "__Host-trpg_owner_session";
const OWNER_SESSION_VERSION = 1;
const OWNER_SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const OWNER_SESSION_REFRESH_SECONDS = 24 * 60 * 60;
const SESSION_CLOCK_SKEW_SECONDS = 5 * 60;
const SESSION_SIGNING_CONTEXT = "trpg-calendar-editor-owner-session-v1";

class AccessAuthError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "AccessAuthError";
    this.code = code;
    this.status = status;
  }
}

function jsonError(error, extra = {}) {
  return new Response(JSON.stringify({
    error: {
      code: error.code || "AUTH_INVALID",
      message: error.message || "認証を確認できませんでした。",
      ...extra,
    },
  }), {
    status: error.status || 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function normalizeTeamDomain(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AccessAuthError("AUTH_CONFIG_ERROR", "認証設定が不足しています。", 500);
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new AccessAuthError("AUTH_CONFIG_ERROR", "認証設定が不足しています。", 500);
  }
  return url.origin;
}

function allowedOwnerEmail(env) {
  const allowedEmail = String(env.ALLOWED_EMAIL || "").trim().toLowerCase();
  if (!allowedEmail) {
    throw new AccessAuthError("AUTH_CONFIG_ERROR", "認証設定が不足しています。", 500);
  }
  return allowedEmail;
}

function requiredAuthConfiguration(env) {
  const issuer = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  const allowedEmail = allowedOwnerEmail(env);
  if (!audience) {
    throw new AccessAuthError("AUTH_CONFIG_ERROR", "認証設定が不足しています。", 500);
  }
  return { issuer, audience, allowedEmail };
}

function sessionSigningSecret(env) {
  // The GitHub token is already a high-entropy, server-only Secret. The fixed
  // context prefix separates its use here from GitHub API authentication.
  const secret = String(env.GITHUB_TOKEN || "").trim();
  if (!secret) {
    throw new AccessAuthError("AUTH_CONFIG_ERROR", "認証設定が不足しています。", 500);
  }
  return `${SESSION_SIGNING_CONTEXT}\0${secret}`;
}

function remoteJwksForIssuer(issuer) {
  if (!remoteKeySets.has(issuer)) {
    remoteKeySets.set(
      issuer,
      createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
    );
  }
  return remoteKeySets.get(issuer);
}

async function verifyAccessJwt(token, env, options = {}) {
  const { issuer, audience, allowedEmail } = requiredAuthConfiguration(env);
  if (!token) throw new AccessAuthError("AUTH_REQUIRED", "Cloudflare Accessへのログインが必要です。", 401);
  const jwks = options.jwks || remoteJwksForIssuer(issuer);
  const verify = options.jwtVerify || jwtVerify;
  let payload;
  try {
    ({ payload } = await verify(token, jwks, {
      issuer,
      audience,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new AccessAuthError("AUTH_INVALID", "Cloudflare Accessの認証を確認できませんでした。", 403);
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email !== allowedEmail) {
    throw new AccessAuthError("EMAIL_NOT_ALLOWED", "このアカウントには編集権限がありません。", 403);
  }
  return payload;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeClaims(claims) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
}

function decodeClaims(value) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(value)));
}

async function hmacSignature(value, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSigningSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function requestOrigin(request) {
  return new URL(request.url).origin;
}

async function createOwnerSession(request, env, options = {}) {
  const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  const claims = {
    v: OWNER_SESSION_VERSION,
    email: allowedOwnerEmail(env),
    origin: requestOrigin(request),
    iat: nowSeconds,
    exp: nowSeconds + OWNER_SESSION_MAX_AGE_SECONDS,
  };
  const encoded = encodeClaims(claims);
  const signature = bytesToBase64Url(await hmacSignature(encoded, env));
  return { token: `${encoded}.${signature}`, claims };
}

async function verifyOwnerSession(token, request, env, options = {}) {
  if (!token || token.length > 4096) throw new AccessAuthError("AUTH_REQUIRED", "ログインが必要です。", 401);
  const parts = token.split(".");
  if (parts.length !== 2) throw new AccessAuthError("AUTH_INVALID", "ログイン情報を確認できませんでした。", 403);
  let claims;
  let suppliedSignature;
  try {
    claims = decodeClaims(parts[0]);
    suppliedSignature = base64UrlToBytes(parts[1]);
  } catch {
    throw new AccessAuthError("AUTH_INVALID", "ログイン情報を確認できませんでした。", 403);
  }
  const expectedSignature = await hmacSignature(parts[0], env);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    throw new AccessAuthError("AUTH_INVALID", "ログイン情報を確認できませんでした。", 403);
  }

  const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  const allowedEmail = allowedOwnerEmail(env);
  const validLifetime = Number.isInteger(claims.iat)
    && Number.isInteger(claims.exp)
    && claims.iat <= nowSeconds + SESSION_CLOCK_SKEW_SECONDS
    && claims.exp > nowSeconds
    && claims.exp - claims.iat <= OWNER_SESSION_MAX_AGE_SECONDS + SESSION_CLOCK_SKEW_SECONDS;
  if (claims.v !== OWNER_SESSION_VERSION
      || claims.email !== allowedEmail
      || claims.origin !== requestOrigin(request)
      || !validLifetime) {
    throw new AccessAuthError("AUTH_INVALID", "ログイン情報の期限が切れています。", 403);
  }
  return claims;
}

function parseCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

function ownerSessionCookie(token, maxAge = OWNER_SESSION_MAX_AGE_SECONDS) {
  return `${OWNER_SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function responseWithCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function loginRedirect(request) {
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL("/auth/bootstrap", request.url).toString(),
      "Referrer-Policy": "no-referrer",
    },
  });
}

function loggedOutResponse() {
  const body = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>ログアウトしました</title></head><body><main><h1>ログアウトしました</h1><p><a href="/auth/bootstrap">もう一度ログインする</a></p></main></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": ownerSessionCookie("", 0),
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function isApiRequest(request) {
  return new URL(request.url).pathname.startsWith("/api/");
}

function shouldRefreshSession(claims, options = {}) {
  const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  return nowSeconds - claims.iat >= OWNER_SESSION_REFRESH_SECONDS;
}

async function authenticateRequest(request, env, options = {}) {
  const sessionToken = parseCookie(request, OWNER_SESSION_COOKIE);
  if (sessionToken) {
    try {
      const claims = await verifyOwnerSession(sessionToken, request, env, options);
      return { source: "owner-session", payload: claims };
    } catch (error) {
      if (!(error instanceof AccessAuthError) || !request.headers.get("Cf-Access-Jwt-Assertion")) throw error;
    }
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const payload = await verifyAccessJwt(token, env, options);
  return { source: "cloudflare-access", payload };
}

function createAuthMiddleware(options = {}) {
  return async function handleRequest(context) {
    const request = context.request;
    const pathname = new URL(request.url).pathname;

    if (pathname === "/auth/logout") return loggedOutResponse();

    if (pathname === "/auth/bootstrap") {
      try {
        const payload = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), context.env, options);
        const session = await createOwnerSession(request, context.env, options);
        const response = new Response(null, {
          status: 303,
          headers: {
            "Cache-Control": "no-store",
            Location: new URL("/", request.url).toString(),
            "Referrer-Policy": "no-referrer",
          },
        });
        context.data.accessUser = { email: payload.email, subject: payload.sub };
        return responseWithCookie(response, ownerSessionCookie(session.token));
      } catch (error) {
        if (error instanceof AccessAuthError) return jsonError(error);
        return jsonError(new AccessAuthError("AUTH_INVALID", "認証処理に失敗しました。", 403));
      }
    }

    try {
      const authentication = await authenticateRequest(request, context.env, options);
      context.data.accessUser = {
        email: authentication.payload.email,
        subject: authentication.payload.sub || "owner-session",
      };
      const response = await context.next();
      if (authentication.source === "cloudflare-access" || shouldRefreshSession(authentication.payload, options)) {
        const session = await createOwnerSession(request, context.env, options);
        return responseWithCookie(response, ownerSessionCookie(session.token));
      }
      return response;
    } catch (error) {
      if (error instanceof AccessAuthError) {
        if (!isApiRequest(request)) return loginRedirect(request);
        return jsonError(error, { login_url: "/auth/bootstrap" });
      }
      const unknown = new AccessAuthError("AUTH_INVALID", "認証処理に失敗しました。", 403);
      if (!isApiRequest(request)) return loginRedirect(request);
      return jsonError(unknown, { login_url: "/auth/bootstrap" });
    }
  };
}

const onRequest = createAuthMiddleware();

export {
  AccessAuthError,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  authenticateRequest,
  createAuthMiddleware,
  createOwnerSession,
  normalizeTeamDomain,
  onRequest,
  ownerSessionCookie,
  requiredAuthConfiguration,
  shouldRefreshSession,
  verifyAccessJwt,
  verifyOwnerSession,
};
