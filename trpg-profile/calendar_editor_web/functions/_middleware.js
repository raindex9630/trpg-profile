import { createRemoteJWKSet, jwtVerify } from "jose";

const remoteKeySets = new Map();

class AccessAuthError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "AccessAuthError";
    this.code = code;
    this.status = status;
  }
}

function jsonError(error) {
  return new Response(JSON.stringify({
    error: {
      code: error.code || "AUTH_INVALID",
      message: error.message || "認証を確認できませんでした。",
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

function requiredAuthConfiguration(env) {
  const issuer = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  const allowedEmail = String(env.ALLOWED_EMAIL || "").trim().toLowerCase();
  if (!audience || !allowedEmail) {
    throw new AccessAuthError("AUTH_CONFIG_ERROR", "認証設定が不足しています。", 500);
  }
  return { issuer, audience, allowedEmail };
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

async function authenticateRequest(request, env, options = {}) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  return verifyAccessJwt(token, env, options);
}

async function onRequest(context) {
  try {
    const payload = await authenticateRequest(context.request, context.env);
    context.data.accessUser = {
      email: payload.email,
      subject: payload.sub,
    };
    return context.next();
  } catch (error) {
    if (error instanceof AccessAuthError) return jsonError(error);
    return jsonError(new AccessAuthError("AUTH_INVALID", "認証処理に失敗しました。", 403));
  }
}

export {
  AccessAuthError,
  authenticateRequest,
  normalizeTeamDomain,
  onRequest,
  requiredAuthConfiguration,
  verifyAccessJwt,
};
