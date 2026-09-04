import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(projectRoot, "public");
const sourceCalendarPath = fileURLToPath(new URL("../../data/calendar.json", import.meta.url));
const port = Number(process.env.CALENDAR_EDITOR_PREVIEW_PORT || 8788);
const host = "127.0.0.1";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

let calendar = JSON.parse(await readFile(sourceCalendarPath, "utf8"));
let sha = createHash("sha1").update(JSON.stringify(calendar)).digest("hex");

function json(response, status = 200) {
  return { status, headers: { "Content-Type": MIME[".json"], "Cache-Control": "no-store" }, body: JSON.stringify(response) };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/calendar") {
      if (request.method === "GET") {
        const result = json({ data: calendar, sha });
        response.writeHead(result.status, result.headers).end(result.body);
        return;
      }
      if (request.method === "PUT") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (payload.baseSha !== sha) {
          const result = json({ error: { code: "SHA_CONFLICT", message: "プレビュー内で競合を検出しました。" } }, 409);
          response.writeHead(result.status, result.headers).end(result.body);
          return;
        }
        calendar = payload.data;
        sha = createHash("sha1").update(JSON.stringify(calendar)).digest("hex");
        const result = json({ data: calendar, sha, commitUrl: "" });
        response.writeHead(result.status, result.headers).end(result.body);
        return;
      }
      const result = json({ error: { code: "METHOD_NOT_ALLOWED", message: "GETまたはPUTを使用してください。" } }, 405);
      response.writeHead(result.status, result.headers).end(result.body);
      return;
    }

    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const filePath = normalize(join(publicRoot, relative));
    if (!filePath.startsWith(publicRoot)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(status === 404 ? "Not found" : "Preview server error");
  }
});
server.listen(port, host, () => {
  process.stdout.write(`Calendar editor preview: http://${host}:${port}\n`);
  process.stdout.write("Changes are kept in memory and never written to data/calendar.json.\n");
});
