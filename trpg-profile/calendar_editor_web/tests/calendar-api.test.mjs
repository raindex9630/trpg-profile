import test from "node:test";
import assert from "node:assert/strict";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import {
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  authenticateRequest,
  createAuthMiddleware,
  createOwnerSession,
  ownerSessionCookie,
  shouldRefreshSession,
  verifyAccessJwt,
  verifyOwnerSession,
} from "../functions/_middleware.js";
import {
  MAX_BODY_BYTES,
  createCalendarApi,
  decodeBase64Utf8,
  encodeBase64Utf8,
} from "../functions/api/calendar.js";
import { emptyData } from "../public/calendar-core.js";

const ENV = {
  GITHUB_TOKEN: "github-secret-token",
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "repo",
  GITHUB_BRANCH: "main",
};
const SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

function validData() {
  const data = emptyData();
  data.events.push({
    id: "event0000001",
    session_id: "session00001",
    title: "テスト卓",
    tag: "PL",
    dates: ["2026-09-04"],
    all_day: false,
    start_time: "21:00",
    end_time: "24:00",
    end_next_day: true,
    is_backup_date: false,
  });
  return data;
}

function githubFile(data = validData(), sha = SHA) {
  return new Response(JSON.stringify({ type: "file", sha, content: encodeBase64Utf8(`${JSON.stringify(data)}\n`) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function context(request, env = ENV) {
  return { request, env, data: {} };
}

function putRequest(body, headers = {}) {
  return new Request("https://editor.example.com/api/calendar", {
    method: "PUT",
    headers: { Origin: "https://editor.example.com", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

async function authFixture() {
  const issuer = "https://example.cloudflareaccess.com";
  const audience = "calendar-editor-aud";
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const env = {
    ...ENV,
    CF_ACCESS_TEAM_DOMAIN: issuer,
    CF_ACCESS_AUD: audience,
    ALLOWED_EMAIL: "owner@example.com",
  };
  async function token(claims = {}, options = {}) {
    return new SignJWT({ email: "owner@example.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(options.issuer || issuer)
      .setAudience(options.audience || audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
  return { issuer, audience, env, jwks, token };
}

test("JWTなしを拒否する", async () => {
  const fixture = await authFixture();
  await assert.rejects(() => verifyAccessJwt("", fixture.env, { jwks: fixture.jwks }), (error) => error.code === "AUTH_REQUIRED");
});

test("無効JWTを拒否する", async () => {
  const fixture = await authFixture();
  await assert.rejects(() => verifyAccessJwt("not-a-jwt", fixture.env, { jwks: fixture.jwks }), (error) => error.code === "AUTH_INVALID");
});

test("誤audienceを拒否する", async () => {
  const fixture = await authFixture();
  const jwt = await fixture.token({}, { audience: "wrong-aud" });
  await assert.rejects(() => verifyAccessJwt(jwt, fixture.env, { jwks: fixture.jwks }), (error) => error.code === "AUTH_INVALID");
});

test("誤issuerを拒否する", async () => {
  const fixture = await authFixture();
  const jwt = await fixture.token({}, { issuer: "https://wrong.cloudflareaccess.com" });
  await assert.rejects(() => verifyAccessJwt(jwt, fixture.env, { jwks: fixture.jwks }), (error) => error.code === "AUTH_INVALID");
});

test("許可外メールを拒否する", async () => {
  const fixture = await authFixture();
  const jwt = await fixture.token({ email: "other@example.com" });
  await assert.rejects(() => verifyAccessJwt(jwt, fixture.env, { jwks: fixture.jwks }), (error) => error.code === "EMAIL_NOT_ALLOWED");
});

test("署名・issuer・audience・メールが正しいJWTを受理する", async () => {
  const fixture = await authFixture();
  const jwt = await fixture.token();
  const payload = await verifyAccessJwt(jwt, fixture.env, { jwks: fixture.jwks });
  assert.equal(payload.email, "owner@example.com");
});

test("所有者セッションCookieを365日で発行し、同じオリジンで受理する", async () => {
  const fixture = await authFixture();
  const now = Date.UTC(2026, 8, 13, 3, 0, 0);
  const request = new Request("https://editor.example.com/");
  const session = await createOwnerSession(request, fixture.env, { now: () => now });
  const claims = await verifyOwnerSession(session.token, request, fixture.env, { now: () => now });
  assert.equal(claims.email, "owner@example.com");
  assert.equal(claims.exp - claims.iat, OWNER_SESSION_MAX_AGE_SECONDS);
  assert.match(ownerSessionCookie(session.token), new RegExp(`^${OWNER_SESSION_COOKIE}=`));
  assert.match(ownerSessionCookie(session.token), /Max-Age=31536000; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
});

test("所有者セッションCookieの改ざん・期限切れ・別オリジンを拒否する", async () => {
  const fixture = await authFixture();
  const now = Date.UTC(2026, 8, 13, 3, 0, 0);
  const request = new Request("https://editor.example.com/");
  const session = await createOwnerSession(request, fixture.env, { now: () => now });
  const lastCharacter = session.token.endsWith("a") ? "b" : "a";
  const tampered = `${session.token.slice(0, -1)}${lastCharacter}`;
  await assert.rejects(() => verifyOwnerSession(tampered, request, fixture.env, { now: () => now }), (error) => error.code === "AUTH_INVALID");
  await assert.rejects(
    () => verifyOwnerSession(session.token, request, fixture.env, { now: () => now + (OWNER_SESSION_MAX_AGE_SECONDS + 1) * 1000 }),
    (error) => error.code === "AUTH_INVALID",
  );
  await assert.rejects(
    () => verifyOwnerSession(session.token, new Request("https://preview.example.com/"), fixture.env, { now: () => now }),
    (error) => error.code === "AUTH_INVALID",
  );
});

test("所有者セッションは24時間後に更新対象になる", async () => {
  const fixture = await authFixture();
  const now = Date.UTC(2026, 8, 13, 3, 0, 0);
  const request = new Request("https://editor.example.com/");
  const session = await createOwnerSession(request, fixture.env, { now: () => now });
  assert.equal(shouldRefreshSession(session.claims, { now: () => now + 23 * 60 * 60 * 1000 }), false);
  assert.equal(shouldRefreshSession(session.claims, { now: () => now + 24 * 60 * 60 * 1000 }), true);
});

test("Cookieだけで認証でき、Access JWTを再検証しない", async () => {
  const fixture = await authFixture();
  const now = Date.UTC(2026, 8, 13, 3, 0, 0);
  const plainRequest = new Request("https://editor.example.com/");
  const session = await createOwnerSession(plainRequest, fixture.env, { now: () => now });
  const request = new Request(plainRequest, { headers: { Cookie: `${OWNER_SESSION_COOKIE}=${session.token}` } });
  const authentication = await authenticateRequest(request, fixture.env, { now: () => now });
  assert.equal(authentication.source, "owner-session");
  assert.equal(authentication.payload.email, "owner@example.com");
});

test("Access認証済みリクエストから長期Cookieを発行する", async () => {
  const fixture = await authFixture();
  const now = Date.UTC(2026, 8, 13, 3, 0, 0);
  const accessToken = await fixture.token();
  const middleware = createAuthMiddleware({ jwks: fixture.jwks, now: () => now });
  const context = {
    request: new Request("https://editor.example.com/", { headers: { "Cf-Access-Jwt-Assertion": accessToken } }),
    env: fixture.env,
    data: {},
    next: async () => new Response("ok"),
  };
  const response = await middleware(context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Set-Cookie") || "", new RegExp(`^${OWNER_SESSION_COOKIE}=`));
  assert.equal(context.data.accessUser.email, "owner@example.com");
});

test("未認証の画面は初回認証へ送り、APIはログインURL付き401を返す", async () => {
  const fixture = await authFixture();
  const middleware = createAuthMiddleware();
  const pageResponse = await middleware({
    request: new Request("https://editor.example.com/"),
    env: fixture.env,
    data: {},
    next: async () => new Response("should not run"),
  });
  assert.equal(pageResponse.status, 302);
  assert.equal(pageResponse.headers.get("Location"), "https://editor.example.com/auth/bootstrap");

  const apiResponse = await middleware({
    request: new Request("https://editor.example.com/api/calendar"),
    env: fixture.env,
    data: {},
    next: async () => new Response("should not run"),
  });
  assert.equal(apiResponse.status, 401);
  assert.equal((await apiResponse.json()).error.login_url, "/auth/bootstrap");
});

test("ログアウトはCookieを削除する", async () => {
  const middleware = createAuthMiddleware();
  const response = await middleware({
    request: new Request("https://editor.example.com/auth/logout"),
    env: {},
    data: {},
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Set-Cookie") || "", new RegExp(`^${OWNER_SESSION_COOKIE}=; Max-Age=0;`));
  assert.match(await response.text(), /もう一度ログインする/);
});

test("GETはGitHubからdataとshaだけを返す", async () => {
  const fetchCalls = [];
  const handler = createCalendarApi({ fetch: async (...args) => { fetchCalls.push(args); return githubFile(); } });
  const result = await responseJson(await handler(context(new Request("https://editor.example.com/api/calendar"))));
  assert.equal(result.status, 200);
  assert.equal(result.body.sha, SHA);
  assert.deepEqual(result.body.data, validData());
  assert.equal(JSON.stringify(result.body).includes(ENV.GITHUB_TOKEN), false);
  assert.equal(fetchCalls.length, 1);
  assert.match(String(fetchCalls[0][0]), /\/contents\/trpg-profile\/data\/calendar\.json/);
});

test("不正JSONを拒否する", async () => {
  const handler = createCalendarApi({ fetch: async () => githubFile() });
  const result = await responseJson(await handler(context(putRequest("{"))));
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "INVALID_JSON");
});

test("不正タグ・日付・時刻をGitHub更新前に拒否する", async () => {
  for (const mutate of [
    (data) => { data.events[0].tag = "invalid"; },
    (data) => { data.events[0].dates = ["2026-02-30"]; },
    (data) => { data.events[0].start_time = "25:00"; },
  ]) {
    const data = validData();
    mutate(data);
    let fetchCount = 0;
    const handler = createCalendarApi({ fetch: async () => { fetchCount += 1; return githubFile(); } });
    const result = await responseJson(await handler(context(putRequest({ baseSha: SHA, data }))));
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "CALENDAR_DATA_INVALID");
    assert.equal(fetchCount, 0);
  }
});

test("過大本文を拒否する", async () => {
  const handler = createCalendarApi({ fetch: async () => githubFile() });
  const request = putRequest("{}", { "Content-Length": String(MAX_BODY_BYTES + 1) });
  const result = await responseJson(await handler(context(request)));
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, "PAYLOAD_TOO_LARGE");
});

test("異なるオリジンを拒否する", async () => {
  const handler = createCalendarApi({ fetch: async () => githubFile() });
  const request = putRequest({ baseSha: SHA, data: validData() }, { Origin: "https://evil.example" });
  const result = await responseJson(await handler(context(request)));
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "ORIGIN_NOT_ALLOWED");
});

test("SHA一致時だけGitHub更新し、JST・UTF-8・インデント・末尾改行を保存する", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === "PUT") {
      return new Response(JSON.stringify({ content: { sha: NEW_SHA }, commit: { html_url: "https://github.com/owner/repo/commit/123" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return githubFile();
  };
  const handler = createCalendarApi({ fetch: fetchMock, now: () => new Date("2026-09-04T15:05:00Z") });
  const result = await responseJson(await handler(context(putRequest({ baseSha: SHA, data: validData() }))));
  assert.equal(result.status, 200);
  assert.equal(result.body.sha, NEW_SHA);
  assert.equal(result.body.data.updated_at, "2026-09-05 00:05");
  assert.equal(calls.length, 2);
  const githubPut = JSON.parse(calls[1].options.body);
  const savedText = decodeBase64Utf8(githubPut.content);
  assert.match(savedText, /\n  "calendar_name"/);
  assert.equal(savedText.endsWith("\n"), true);
  assert.equal(JSON.parse(savedText).events[0].title, "テスト卓");
});

test("SHA不一致は409でGitHub更新しない", async () => {
  let updateCount = 0;
  const handler = createCalendarApi({ fetch: async (_url, options = {}) => {
    if (options.method === "PUT") updateCount += 1;
    return githubFile(validData(), NEW_SHA);
  } });
  const result = await responseJson(await handler(context(putRequest({ baseSha: SHA, data: validData() }))));
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "SHA_CONFLICT");
  assert.equal(updateCount, 0);
});

test("GitHub API失敗は秘密を含まない安全なエラーを返す", async () => {
  const handler = createCalendarApi({ fetch: async () => new Response(JSON.stringify({ message: `bad ${ENV.GITHUB_TOKEN}` }), { status: 403, headers: { "Content-Type": "application/json" } }) });
  const response = await handler(context(new Request("https://editor.example.com/api/calendar")));
  const text = await response.text();
  assert.equal(response.status, 502);
  assert.equal(text.includes(ENV.GITHUB_TOKEN), false);
  assert.equal(text.includes("bad"), false);
});
