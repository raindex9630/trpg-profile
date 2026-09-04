import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/editor.css", import.meta.url), "utf8");
const js = await readFile(new URL("../public/editor.js", import.meta.url), "utf8");

test("主要操作・ラベル・ライブ領域がHTMLにある", () => {
  for (const text of ["GitHubへ保存", "最新版を再読込", "新規セッション", "予定アリ", "日程を複製", "リスケ", "月メモを反映"]) assert.match(html, new RegExp(text));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="表示月のセッション"/);
});
test("320pxを含む狭幅向けレイアウトとフォーカス表示がある", () => {
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /focus-visible/);
});

test("未保存警告・競合保持・Undo上限を実装している", () => {
  assert.match(js, /beforeunload/);
  assert.match(js, /HISTORY_LIMIT = 100/);
  assert.match(js, /編集中の内容は保持/);
  assert.match(js, /未反映のフォーム内容は保存されません/);
});

test("ブラウザ資産に秘密設定名を含めない", () => {
  const browserAssets = `${html}\n${css}\n${js}`;
  for (const secret of ["GITHUB_TOKEN", "CF_ACCESS_AUD", "ALLOWED_EMAIL"]) assert.equal(browserAssets.includes(secret), false);
});
