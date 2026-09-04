import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticallyEndsNextDay,
  coalesceSameTitleSessions,
  createScheduleEvents,
  deepClone,
  duplicateSessionEvents,
  emptyData,
  japanTimestamp,
  normalizeData,
  normalizeEndTimeText,
  normalizeStartTimeText,
  prepareCalendarForSave,
  rescheduleScheduleEvent,
  updateScheduleFields,
  updateSessionFields,
  validateCalendarData,
} from "../public/calendar-core.js";

function ids(...values) {
  let index = 0;
  return () => values[index++] || `generated${String(index).padStart(3, "0")}`;
}

function regular(overrides = {}) {
  return {
    all_day: false,
    start_time: "21:00",
    end_time: "24:00",
    end_next_day: true,
    is_backup_date: false,
    schedule_note: "",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: "event0000001",
    session_id: "session00001",
    title: "NOBODY*2",
    tag: "PL",
    dates: ["2026-09-01"],
    ...regular(),
    ...overrides,
  };
}

test("異なる時刻の日程追加で既存日程を変更しない", () => {
  const original = event();
  const before = deepClone(original);
  const added = createScheduleEvents(original.session_id, original.title, original.tag, ["2026-09-02"], regular({ start_time: "19:30", end_time: "23:00", end_next_day: false }), { idFactory: ids("event0000002") });
  assert.deepEqual(original, before);
  assert.equal(added[0].start_time, "19:30");
});
test("個別編集は対象eventだけを変更する", () => {
  const events = [event(), event({ id: "event0000002", dates: ["2026-09-02"] })];
  const untouched = deepClone(events[1]);
  updateScheduleFields(events[0], regular({ start_time: "20:00", end_time: "25:00", schedule_note: "2陣" }));
  assert.equal(events[0].start_time, "20:00");
  assert.deepEqual(events[1], untouched);
});

test("セッション名・種別変更は日程固有項目を変更しない", () => {
  const events = [event(), event({ id: "event0000002", dates: ["2026-09-02"], schedule_note: "予備" })];
  const locals = events.map(({ dates, start_time, end_time, is_backup_date, schedule_note }) => ({ dates, start_time, end_time, is_backup_date, schedule_note }));
  updateSessionFields(events, "session00001", "新しい名前", "GM");
  assert.deepEqual(events.map(({ dates, start_time, end_time, is_backup_date, schedule_note }) => ({ dates, start_time, end_time, is_backup_date, schedule_note })), locals);
  assert.deepEqual(events.map(({ title, tag }) => ({ title, tag })), [{ title: "新しい名前", tag: "GM" }, { title: "新しい名前", tag: "GM" }]);
});

test("複数日追加は日付ごとに異なるidを発行する", () => {
  const created = createScheduleEvents("session00001", "卓", "GM", ["2026-09-04", "2026-09-03"], regular(), { idFactory: ids("event0000001", "event0000002") });
  assert.deepEqual(created.map((item) => item.dates[0]), ["2026-09-03", "2026-09-04"]);
  assert.notEqual(created[0].id, created[1].id);
});

test("リスケは元日程を新しいidの日程へ置換する", () => {
  const events = [event(), event({ id: "event0000002", dates: ["2026-09-02"] })];
  const moved = rescheduleScheduleEvent(events, "event0000001", "2026-09-10", regular({ start_time: "20:00", end_time: "24:30" }), { idFactory: ids("event0000003") });
  assert.equal(moved.id, "event0000003");
  assert.deepEqual(moved.dates, ["2026-09-10"]);
  assert.equal(events.some((item) => item.id === "event0000001"), false);
  assert.equal(events[1].id, "event0000002");
});

test("日程複製用の生成は元データを変更しない", () => {
  const source = event({ schedule_note: "2陣" });
  const before = deepClone(source);
  const copies = createScheduleEvents(source.session_id, source.title, source.tag, ["2026-09-08"], source, { idFactory: ids("event0000009") });
  assert.deepEqual(source, before);
  assert.equal(copies[0].schedule_note, "2陣");
});

test("セッション複製は新しいsession_idと全日程の新しいidを持つ", () => {
  const events = [event(), event({ id: "event0000002", dates: ["2026-09-02"] })];
  const [sessionId, copies] = duplicateSessionEvents(events, "session00001", "NOBODY*2（コピー）", { idFactory: ids("session00002", "event0000003", "event0000004") });
  assert.equal(sessionId, "session00002");
  assert.deepEqual(copies.map((item) => item.session_id), ["session00002", "session00002"]);
  assert.deepEqual(copies.map((item) => item.id), ["event0000003", "event0000004"]);
});

test("予定アリは各日程が独立したsession_idを持つ", () => {
  const created = createScheduleEvents("ignored", "夜×", "×", ["2026-09-01", "2026-09-02"], { ...regular(), blocked_period: "night" }, { idFactory: ids("blocked00001", "blocked00002") });
  assert.deepEqual(created.map((item) => item.session_id), created.map((item) => item.id));
  assert.deepEqual(created.map((item) => item.is_backup_date), [false, false]);
});

test("補足と予備日の違いで同名セッションを分割しない", () => {
  const events = [
    event({ session_id: "session00001", schedule_note: "1陣" }),
    event({ id: "event0000002", session_id: "session00002", dates: ["2026-09-02"], schedule_note: "2陣", is_backup_date: true }),
  ];
  coalesceSameTitleSessions(events);
  assert.equal(new Set(events.map((item) => item.session_id)).size, 1);
});

test("旧形式の複数日datesを独立eventへ展開する", () => {
  const data = emptyData();
  data.events = [event({ dates: ["2026-09-03", "2026-09-01", "2026-09-03"] })];
  const normalized = normalizeData(data, { idFactory: ids("event0000002") });
  assert.deepEqual(normalized.events.map((item) => item.dates), [["2026-09-01"], ["2026-09-03"]]);
  assert.notEqual(normalized.events[0].id, normalized.events[1].id);
});

test("開始時刻と47:59までの終了時刻を正規化する", () => {
  assert.equal(normalizeStartTimeText("1300"), "13:00");
  assert.equal(normalizeStartTimeText("24:00"), "");
  assert.equal(normalizeEndTimeText("4759"), "47:59");
  assert.equal(normalizeEndTimeText("48:00"), "");
});

test("00:00終了を24:00へ正規化する", () => {
  assert.equal(normalizeEndTimeText("00:00"), "24:00");
});

test("翌日終了を自動判定する", () => {
  assert.equal(automaticallyEndsNextDay("21:00", "25:00"), true);
  assert.equal(automaticallyEndsNextDay("21:00", "02:00"), true);
  assert.equal(automaticallyEndsNextDay("10:00", "18:00"), false);
  assert.equal(automaticallyEndsNextDay("", "18:00", true), false);
});

test("空の月メモと日程補足を保存結果から除外する", () => {
  const data = emptyData();
  data.monthly_notes = { "2026-09": "  ", "2026-10": " メモ " };
  data.events = [event({ schedule_note: "  " })];
  const saved = prepareCalendarForSave(data, new Date("2026-09-04T01:02:00Z"));
  assert.deepEqual(saved.monthly_notes, { "2026-10": "メモ" });
  assert.equal(Object.hasOwn(saved.events[0], "schedule_note"), false);
});

test("updated_atを日本時間で生成する", () => {
  assert.equal(japanTimestamp(new Date("2026-09-04T15:05:00Z")), "2026-09-05 00:05");
});

test("厳格検証は不正タグ・日付・時刻を拒否する", () => {
  const data = emptyData();
  data.events = [event({ tag: "UNKNOWN", dates: ["2026-02-30"], start_time: "25:00" })];
  const errors = validateCalendarData(data).join("\n");
  assert.match(errors, /tag/);
  assert.match(errors, /dates/);
});
