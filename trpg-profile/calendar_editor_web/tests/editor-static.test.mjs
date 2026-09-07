import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as calendarCore from "../public/calendar-core.js";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/editor.css", import.meta.url), "utf8");
const js = await readFile(new URL("../public/editor.js", import.meta.url), "utf8");

// Exercise the real selection/close functions without a browser or API writes.
function selectionHarness(confirmAnswer = true) {
  const nodes = new Map();
  let confirms = 0;
  const sandbox = {
    ...calendarCore,
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, {
          hidden: false,
          dataset: {},
          classList: { add() {}, remove() {} },
          focus() {},
        });
        return nodes.get(id);
      },
    },
    window: {
      confirm() { confirms += 1; return confirmAnswer; },
      clearTimeout() {},
    },
  };
  const definitions = js.slice(0, js.indexOf('elements.new_session_button.addEventListener'))
    .replace(/^import \{[\s\S]*?\} from "\.\/calendar-core\.js";/, "");
  runInNewContext(`${definitions}
    renderCalendar = () => {};
    renderOccurrences = () => {};
    renderPanel = () => { elements.edit_panel.hidden = false; };
    globalThis.selection = { state, openCreatePanel, toggleDraftDate, removeDraftOccurrence, setPanelBaseline };
  `, sandbox);
  return { ...sandbox.selection, nodes, confirms: () => confirms };
}

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

test("閲覧画面の3段見出しとカレンダーの表示寸法を維持する", () => {
  assert.match(css, /\.month-heading-line\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.calendar-updated\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.calendar-viewport\s*\{[^}]*border-radius:\s*16px/s);
  assert.match(css, /\.event-title\s*\{[^}]*font-size:\s*11px/s);
  assert.match(css, /\.event-time\s*\{[^}]*margin-top:\s*4px;[^}]*font-size:\s*9\.4px/s);
  assert.match(css, /--monthly-note-height:\s*120px/);
  assert.match(css, /\.monthly-note p\s*\{[^}]*overflow-y:\s*auto/s);
  assert.ok(css.indexOf(".tag-gm {") > css.indexOf(".event-card {"), "種別の淡色罫線をカードの基本border宣言で上書きしない");
  const monthActions = html.match(/<div class="month-actions">([\s\S]*?)<\/div>/)[1];
  assert.equal((monthActions.match(/<button /g) || []).length, 3);
  assert.doesNotMatch(monthActions, /new-session-button/);
  assert.match(html, /class="editor-toolbar-tools"/);
});

test("スマホでも共有URLを残し、成功通知は閲覧の邪魔にならない", () => {
  assert.doesNotMatch(css, /\.copy-url-button\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@container calendar \(max-width: 620px\)/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(js, /setStatus\(initial \? ""/);
  assert.match(js, /clearTimeout\(statusDismissTimer\)/);
  assert.match(js, /kind === "success"[\s\S]*?setTimeout/);
});

test("日付から追加を始め、最後の日付を外すと確認なしで閉じる", () => {
  const ui = selectionHarness();
  ui.openCreatePanel("2026-09-05");
  ui.toggleDraftDate("2026-09-05");
  assert.equal(ui.state.panel, null);
  assert.equal(ui.nodes.get("edit-panel").hidden, true);
  assert.equal(ui.confirms(), 0);
});

test("追加ボタンでは0件で開き、複数日の最後の選択を外すと閉じる", () => {
  const ui = selectionHarness();
  ui.openCreatePanel();
  assert.ok(ui.state.panel);
  ui.toggleDraftDate("2026-09-05");
  ui.toggleDraftDate("2026-10-05");
  ui.toggleDraftDate("2026-09-05");
  assert.equal(ui.state.panel.occurrences.length, 1);
  ui.toggleDraftDate("2026-10-05");
  assert.equal(ui.state.panel, null);
  assert.equal(ui.confirms(), 0);
});

test("左の日程削除ボタンも最後の選択解除と同じ処理を使う", () => {
  const ui = selectionHarness();
  ui.openCreatePanel("2026-09-05");
  ui.removeDraftOccurrence(ui.state.panel.occurrences[0].key);
  assert.equal(ui.state.panel, null);
  assert.match(js, /occurrence_list\.addEventListener\("click",[\s\S]*?removeDraftOccurrence\(key\)/);
});

test("未保存の名前や時刻を破棄しない場合は最後の日付も維持する", () => {
  for (const edit of [
    (panel) => { panel.scenarioName = "入力中のセッション"; },
    (panel) => { panel.occurrences[0].end_time = "25:00"; },
  ]) {
    const ui = selectionHarness(false);
    ui.openCreatePanel("2026-09-05");
    edit(ui.state.panel);
    const before = JSON.stringify(ui.state.panel);
    ui.toggleDraftDate("2026-09-05");
    assert.equal(JSON.stringify(ui.state.panel), before);
    assert.equal(ui.nodes.get("edit-panel").hidden, false);
    assert.equal(ui.confirms(), 1);
  }
});

test("未保存入力の破棄を確認すると最後の選択解除で閉じる", () => {
  const ui = selectionHarness(true);
  ui.openCreatePanel("2026-09-05");
  ui.state.panel.scenarioName = "入力中のセッション";
  ui.toggleDraftDate("2026-09-05");
  assert.equal(ui.state.panel, null);
  assert.equal(ui.confirms(), 1);
});

test("既存セッションの最後の日程は誤削除を防止する", () => {
  const ui = selectionHarness();
  ui.openCreatePanel("2026-09-05");
  ui.state.panel.mode = "edit";
  ui.state.panel.occurrences[0].eventId = "existing-event";
  ui.setPanelBaseline();
  ui.toggleDraftDate("2026-09-05");
  assert.equal(ui.state.panel.occurrences.length, 1);
  assert.match(ui.nodes.get("status").textContent, /セッション削除/);
});
