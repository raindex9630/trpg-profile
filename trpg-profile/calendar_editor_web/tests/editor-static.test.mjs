import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as calendarCore from "../public/calendar-core.js";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/editor.css", import.meta.url), "utf8");
const js = await readFile(new URL("../public/editor.js", import.meta.url), "utf8");
const publicCalendarJs = await readFile(new URL("../../calendar.js", import.meta.url), "utf8");

// Exercise the real selection/close functions without a browser or API writes.
function selectionHarness(confirmAnswer = true, animated = false) {
  const nodes = new Map();
  const animations = [];
  let confirms = 0;
  const sandbox = {
    ...calendarCore,
    document: {
      getElementById(id) {
        if (!nodes.has(id)) {
          const classes = new Set();
          nodes.set(id, {
            hidden: id === "edit-panel",
            dataset: {},
            style: { setProperty() {} },
            classList: {
              add(value) { classes.add(value); },
              remove(value) { classes.delete(value); },
              contains(value) { return classes.has(value); },
            },
            contains() { return false; },
            getAnimations() {
              if (!animated) return [];
              let resolve, reject;
              const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
              animations.push({ resolve, reject });
              return [{ finished }];
            },
            focus() {},
          });
        }
        return nodes.get(id);
      },
    },
    window: {
      confirm() { confirms += 1; return confirmAnswer; },
      clearTimeout() {},
      setTimeout() {},
      getComputedStyle() { return { transform: "matrix(1, 0, 0, 1, 0, 0)", opacity: "1" }; },
    },
  };
  const definitions = js.slice(0, js.indexOf('elements.new_session_button.addEventListener'))
    .replace(/^import \{[\s\S]*?\} from "\.\/calendar-core\.js";/, "");
  runInNewContext(`${definitions}
    renderCalendar = () => {};
    renderOccurrences = () => {};
    renderPanel = () => showPanel();
    globalThis.selection = { state, elements, openCreatePanel, closePanel, toggleDraftDate, removeDraftOccurrence, setPanelBaseline, defaultOccurrence, applyBulkTime, normalizedWheelDelta, wheelMonthOffset };
  `, sandbox);
  return { ...sandbox.selection, nodes, animations, confirms: () => confirms };
}

test("統合カレンダーの主要操作・ラベル・ライブ領域がHTMLにある", () => {
  for (const text of ["GitHubへ保存", "最新版を再読込", "＋ セッション追加", "予定アリ", "カレンダー上の日付をクリックして追加", "全日程に適用", "追加した日程だけに適用", "このセッションに日程を追加", "セッション削除", "月メモを編集"]) assert.match(html, new RegExp(text));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="月間予定カレンダー"/);
});

test("管理メニューから長期セッションをログアウトできる", () => {
  assert.match(html, /class="menu-logout-link" href="\/auth\/logout"/);
  assert.match(css, /\.owner-menu-panel \.menu-logout-link/);
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

test("日付のマウスホバーは背景だけを薄く灰色にする", () => {
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.calendar-day:hover\s*\{\s*background-image: linear-gradient\(rgba\(84, 93, 104, 0\.08\), rgba\(84, 93, 104, 0\.08\)\);\s*\}/);
  assert.match(css, /\.calendar-day\.is-draft-selected\s*\{[^}]*box-shadow:\s*inset/s);
});

test("ホイールの各入力で待たずに月を連続移動できる", () => {
  const ui = selectionHarness();
  const wheelHandler = js.slice(
    js.indexOf('elements.calendar_grid.addEventListener("wheel"'),
    js.indexOf('elements.calendar_grid.addEventListener("pointerdown"'),
  );
  assert.equal(ui.normalizedWheelDelta({ deltaMode: 0, deltaY: 100 }, 800), 100);
  assert.equal(ui.normalizedWheelDelta({ deltaMode: 1, deltaY: -3 }, 800), -96);
  assert.equal(ui.wheelMonthOffset(59), 0);
  assert.equal(ui.wheelMonthOffset(100), 1);
  assert.equal(ui.wheelMonthOffset(-100), -1);
  assert.equal(ui.wheelMonthOffset(300), 3);
  assert.equal(ui.wheelMonthOffset(-5000), -12);
  assert.doesNotMatch(wheelHandler, /wheelLockedUntil|setTimeout/);
  assert.match(wheelHandler, /const offset = wheelMonthOffset\(state\.wheelTotal\);[\s\S]*?changeMonth\(offset\);[\s\S]*?state\.wheelTotal = 0;/);
  assert.doesNotMatch(publicCalendarJs, /wheelCooldown|wheelResetTimer/);
  assert.match(publicCalendarJs, /const offset = wheelMonthOffset\(wheelDelta\);[\s\S]*?moveMonth\(offset\);[\s\S]*?wheelDelta = 0;/);
});

test("左ペインは開閉時にスライドし、カレンダーの幅も滑らかに変わる", () => {
  assert.match(css, /\.editor-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0px, 0px\) minmax\(0, 1fr\)/s);
  assert.match(css, /--panel-open-duration:\s*260ms/);
  assert.match(css, /\.editor-workspace\s*\{[^}]*transition:\s*grid-template-columns/s);
  assert.match(css, /\.calendar-shell\s*\{[^}]*grid-column:\s*2/s);
  assert.match(css, /\.edit-panel\s*\{[^}]*width:\s*var\(--panel-width\)/s);
  assert.match(css, /\.edit-panel:not\(\[hidden\]\)\s*\{\s*animation:\s*panel-slide-in/);
  assert.match(css, /@keyframes panel-slide-in\s*\{\s*from\s*\{[^}]*translateX\(calc\(-100% - 14px\)\)/);
  assert.match(css, /\.is-panel-closing \.edit-panel:not\(\[hidden\]\)\s*\{\s*animation-name:\s*panel-slide-out/);
  assert.match(css, /@keyframes panel-slide-out\s*\{[^}]*--panel-close-transform[\s\S]*?to\s*\{[^}]*translateX\(calc\(-100% - 14px\)\)/);
  assert.match(css, /animation-name:\s*panel-slide-out, panel-collapse/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none !important/);
});

test("動きを減らす設定ではペインのスライドとカレンダーの幅アニメーションを止める", () => {
  const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reducedMotion, /\.editor-workspace\s*\{\s*transition:\s*none/);
  assert.match(reducedMotion, /\.edit-panel:not\(\[hidden\]\)\s*\{\s*animation:\s*none/);
});

test("閉じる動きが終わるまで表示を保ち、操作だけを無効化する", async () => {
  const ui = selectionHarness(true, true);
  ui.openCreatePanel("2026-09-05");
  ui.toggleDraftDate("2026-09-05");
  const pane = ui.nodes.get("edit-panel");
  const workspace = ui.nodes.get("workspace");
  assert.equal(ui.state.panel, null);
  assert.equal(pane.hidden, false);
  assert.equal(pane.inert, true);
  assert.equal(workspace.classList.contains("is-panel-open"), false);
  assert.equal(workspace.classList.contains("is-panel-closing"), true);
  ui.animations[0].resolve();
  await new Promise(setImmediate);
  assert.equal(pane.hidden, true);
  assert.equal(pane.inert, false);
  assert.equal(workspace.classList.contains("is-panel-closing"), false);
});

test("閉じる途中で再度開いても古いアニメーションで消えない", async () => {
  const ui = selectionHarness(true, true);
  ui.openCreatePanel();
  ui.closePanel();
  ui.openCreatePanel("2026-09-12");
  ui.animations[0].resolve();
  await new Promise(setImmediate);
  assert.equal(ui.nodes.get("edit-panel").hidden, false);
  assert.equal(ui.nodes.get("edit-panel").inert, false);
  assert.equal(ui.nodes.get("workspace").classList.contains("is-panel-closing"), false);
  assert.equal(ui.state.panel.occurrences[0].date, "2026-09-12");
});

test("連続開閉では最新の閉じる動きが終わるまで表示を保つ", async () => {
  const ui = selectionHarness(true, true);
  ui.openCreatePanel();
  ui.closePanel();
  ui.openCreatePanel();
  ui.closePanel();
  ui.animations[0].resolve();
  await new Promise(setImmediate);
  assert.equal(ui.nodes.get("edit-panel").hidden, false);
  ui.animations[1].resolve();
  await new Promise(setImmediate);
  assert.equal(ui.nodes.get("edit-panel").hidden, true);
});

test("動きの途中でアニメーションが停止しても閉鎖を完了する", async () => {
  const ui = selectionHarness(true, true);
  ui.openCreatePanel();
  ui.closePanel();
  ui.animations[0].reject(new Error("Animation cancelled"));
  await new Promise(setImmediate);
  assert.equal(ui.nodes.get("edit-panel").hidden, true);
});

test("破棄確認でキャンセルした場合は閉じる動きを始めない", () => {
  const ui = selectionHarness(false, true);
  ui.openCreatePanel();
  ui.state.panel.scenarioName = "編集中";
  assert.equal(ui.closePanel(), false);
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.nodes.get("edit-panel").hidden, false);
  assert.equal(ui.nodes.get("edit-panel").inert, false);
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

test("追加日程だけへの一括時刻適用は既存日程を変更しない", () => {
  const ui = selectionHarness();
  ui.openCreatePanel("2026-09-05");
  ui.state.panel.mode = "edit";
  ui.state.panel.occurrences[0].eventId = "existing-event";
  ui.state.panel.occurrences[0].start_time = "21:00";
  ui.state.panel.occurrences[0].end_time = "24:00";
  ui.state.panel.occurrences.push(ui.defaultOccurrence("2026-09-12"));
  ui.state.panel.occurrences.push(ui.defaultOccurrence("2026-09-19"));
  ui.elements.bulk_start_time.value = "13:00";
  ui.elements.bulk_end_time.value = "24:00";

  ui.applyBulkTime(true);

  assert.equal(
    JSON.stringify(ui.state.panel.occurrences.map(({ eventId, start_time, end_time }) => ({ eventId, start_time, end_time }))),
    JSON.stringify([
      { eventId: "existing-event", start_time: "21:00", end_time: "24:00" },
      { eventId: "", start_time: "13:00", end_time: "24:00" },
      { eventId: "", start_time: "13:00", end_time: "24:00" },
    ]),
  );
  assert.match(ui.nodes.get("status").textContent, /追加した日程だけ/);
});
