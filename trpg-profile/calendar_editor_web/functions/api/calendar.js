import {
  prepareCalendarForSave,
  validateCalendarData,
} from "../../public/calendar-core.js";

const MAX_BODY_BYTES = 256 * 1024;
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_CALENDAR_PATH = "trpg-profile/data/calendar.json";

class CalendarApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "CalendarApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function responseHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(headers),
  });
}

function safeErrorResponse(error) {
  if (error instanceof CalendarApiError) {
    const body = { error: { code: error.code, message: error.message } };
    if (Array.isArray(error.details) && error.details.length) {
      body.error.details = error.details.slice(0, 20);
    }
    return jsonResponse(body, error.status);
  }
  return jsonResponse({
    error: {
      code: "INTERNAL_ERROR",
      message: "カレンダー処理中に予期しないエラーが発生しました。",
    },
  }, 500);
}

function githubConfiguration(env) {
  const values = {
    token: String(env.GITHUB_TOKEN || "").trim(),
    owner: String(env.GITHUB_OWNER || "").trim(),
    repo: String(env.GITHUB_REPO || "").trim(),
    branch: String(env.GITHUB_BRANCH || "").trim(),
    path: String(env.GITHUB_CALENDAR_PATH || DEFAULT_CALENDAR_PATH).trim(),
  };
  if (Object.values(values).some((value) => !value)) {
    throw new CalendarApiError(500, "GITHUB_CONFIG_ERROR", "GitHub保存設定が不足しています。");
  }
  if (values.path.startsWith("/") || values.path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new CalendarApiError(500, "GITHUB_CONFIG_ERROR", "GitHub保存設定が不正です。");
  }
  return values;
}

function githubContentsUrl(config) {
  const path = config.path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "trpg-calendar-editor",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function parseGithubJson(response) {
  try {
    return await response.json();
  } catch {
    throw new CalendarApiError(502, "GITHUB_INVALID_RESPONSE", "GitHubから不正な応答を受け取りました。");
  }
}

function githubFailure(response) {
  if (response.status === 401 || response.status === 403) {
    return new CalendarApiError(502, "GITHUB_AUTH_FAILED", "GitHubへの認証に失敗しました。");
  }
  if (response.status === 404) {
    return new CalendarApiError(502, "GITHUB_FILE_NOT_FOUND", "GitHub上のカレンダーを取得できませんでした。");
  }
  if (response.status === 409 || response.status === 422) {
    return new CalendarApiError(409, "GITHUB_UPDATE_CONFLICT", "GitHub側で更新が競合しました。編集中の内容は保持されています。");
  }
  return new CalendarApiError(502, "GITHUB_REQUEST_FAILED", "GitHubとの通信に失敗しました。");
}

function decodeBase64Utf8(value) {
  const compact = String(value || "").replace(/\s/g, "");
  let binary;
  try {
    binary = atob(compact);
  } catch {
    throw new CalendarApiError(502, "CALENDAR_DECODE_FAILED", "GitHub上のカレンダーを復号できませんでした。");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function getGithubCalendar(config, fetchImpl) {
  const url = new URL(githubContentsUrl(config));
  url.searchParams.set("ref", config.branch);
  let response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders(config.token) });
  } catch {
    throw new CalendarApiError(502, "GITHUB_UNAVAILABLE", "GitHubへ接続できませんでした。");
  }
  if (!response.ok) throw githubFailure(response);
  const payload = await parseGithubJson(response);
  if (payload?.type !== "file" || typeof payload.sha !== "string" || typeof payload.content !== "string") {
    throw new CalendarApiError(502, "GITHUB_INVALID_RESPONSE", "GitHubから不正な応答を受け取りました。");
  }
  let data;
  try {
    data = JSON.parse(decodeBase64Utf8(payload.content));
  } catch (error) {
    if (error instanceof CalendarApiError) throw error;
    throw new CalendarApiError(502, "CALENDAR_JSON_INVALID", "GitHub上のカレンダーJSONが不正です。");
  }
  const validationErrors = validateCalendarData(data);
  if (validationErrors.length) {
    throw new CalendarApiError(502, "CALENDAR_DATA_INVALID", "GitHub上のカレンダーデータが不正です。", validationErrors);
  }
  return { data, sha: payload.sha };
}

async function updateGithubCalendar(config, sha, serializedData, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(githubContentsUrl(config), {
      method: "PUT",
      headers: {
        ...githubHeaders(config.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "卓予定カレンダーをWeb編集",
        content: encodeBase64Utf8(serializedData),
        sha,
        branch: config.branch,
      }),
    });
  } catch {
    throw new CalendarApiError(502, "GITHUB_UNAVAILABLE", "GitHubへ接続できませんでした。編集中の内容は保持されています。");
  }
  if (!response.ok) throw githubFailure(response);
  const payload = await parseGithubJson(response);
  const newSha = payload?.content?.sha;
  if (typeof newSha !== "string") {
    throw new CalendarApiError(502, "GITHUB_INVALID_RESPONSE", "GitHubから保存結果を確認できませんでした。");
  }
  return {
    sha: newSha,
    commitUrl: typeof payload?.commit?.html_url === "string" ? payload.commit.html_url : "",
  };
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new CalendarApiError(403, "ORIGIN_NOT_ALLOWED", "同一オリジンからの操作だけが許可されています。");
  }
}

async function readPutBody(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new CalendarApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type は application/json にしてください。");
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new CalendarApiError(413, "PAYLOAD_TOO_LARGE", "保存データが大きすぎます。");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new CalendarApiError(413, "PAYLOAD_TOO_LARGE", "保存データが大きすぎます。");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CalendarApiError(400, "INVALID_JSON", "リクエストJSONが不正です。");
  }
}

function createCalendarApi(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || (() => new Date());
  return async function onRequest(context) {
    try {
      const method = context.request.method.toUpperCase();
      if (method !== "GET" && method !== "PUT") {
        return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "GETまたはPUTを使用してください。" } }, 405, { Allow: "GET, PUT" });
      }
      const config = githubConfiguration(context.env);
      if (method === "GET") {
        const current = await getGithubCalendar(config, fetchImpl);
        return jsonResponse(current);
      }

      assertSameOrigin(context.request);
      const body = await readPutBody(context.request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new CalendarApiError(400, "INVALID_REQUEST", "保存リクエストの形式が不正です。");
      }
      if (!/^[0-9a-f]{40}$/i.test(String(body.baseSha || ""))) {
        throw new CalendarApiError(400, "INVALID_BASE_SHA", "保存元SHAが不正です。最新版を再読込してください。");
      }
      const validationErrors = validateCalendarData(body.data);
      if (validationErrors.length) {
        throw new CalendarApiError(400, "CALENDAR_DATA_INVALID", "カレンダーデータが不正です。", validationErrors);
      }

      const current = await getGithubCalendar(config, fetchImpl);
      if (current.sha !== body.baseSha) {
        throw new CalendarApiError(409, "SHA_CONFLICT", "別の場所で更新されています。編集中の内容を保持したまま、最新データを確認してください。");
      }
      const savedData = prepareCalendarForSave(body.data, now());
      const savedValidationErrors = validateCalendarData(savedData);
      if (savedValidationErrors.length) {
        throw new CalendarApiError(400, "CALENDAR_DATA_INVALID", "正規化後のカレンダーデータが不正です。", savedValidationErrors);
      }
      const serialized = `${JSON.stringify(savedData, null, 2)}\n`;
      const result = await updateGithubCalendar(config, current.sha, serialized, fetchImpl);
      return jsonResponse({
        data: savedData,
        sha: result.sha,
        commitUrl: result.commitUrl,
      });
    } catch (error) {
      return safeErrorResponse(error);
    }
  };
}

const onRequest = createCalendarApi();

export {
  DEFAULT_CALENDAR_PATH,
  CalendarApiError,
  MAX_BODY_BYTES,
  createCalendarApi,
  decodeBase64Utf8,
  encodeBase64Utf8,
  getGithubCalendar,
  githubConfiguration,
  onRequest,
  updateGithubCalendar,
};
