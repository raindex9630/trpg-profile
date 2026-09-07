import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/editor.css", import.meta.url), "utf8");
const js = await readFile(new URL("../public/editor.js", import.meta.url), "utf8");

test("統合カレンダーの主要操作・ラベル・ライブ領域がHTMLにある", () => {
  for (const text of ["GitHubへ保存", "最新版を再読込", "＋ セッション追加", "予定アリ", "カレンダー上の日付をクリックして追加", "全日程に適用", "このセッションに日程を追加", "セッション削除", "月メモを編集"]) assert.match(html, new RegExp(text));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="月間予定カレンダー"/);
});
test("左パネルがカレンダーを押して縮め、狭幅でも重ならない", () => {
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /grid-template-columns:\s*minmax\(360px, 400px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.panel-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.panel-footer\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /focus-visible/);
});

test("未保存警告・競合保持・Undo上限・直接保存を実装している", () => {
  assert.match(js, /beforeunload/);
  assert.match(js, /HISTORY_LIMIT = 100/);
  assert.match(js, /入力内容は保持/);
  assert.match(js, /入力中の変更を破棄/);
  assert.match(js, /createSessionEventsFromOccurrences/);
  assert.match(js, /replaceSessionOccurrences/);
  assert.match(js, /method: "PUT"/);
});

test("ブラウザ資産に秘密設定名を含めない", () => {
  const browserAssets = `${html}\n${css}\n${js}`;
  for (const secret of ["GITHUB_TOKEN", "CF_ACCESS_AUD", "ALLOWED_EMAIL"]) assert.equal(browserAssets.includes(secret), false);
});
