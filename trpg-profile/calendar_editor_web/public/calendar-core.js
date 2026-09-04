const VALID_TAGS = Object.freeze(["GM", "PL", "仮押さえ", "×"]);
const PERIOD_TAGS = new Set(["仮押さえ", "×"]);
const BLOCKED_PERIODS = Object.freeze({
  all_day: { label: "終日", holdLabel: "全日", title: "×", startTime: "10:00" },
  day: { label: "昼", holdLabel: "昼", title: "昼×", startTime: "13:00" },
  night: { label: "夜", holdLabel: "夜", title: "夜×", startTime: "21:00" },
});

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const START_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const END_TIME_PATTERN = /^(?:[0-3]\d|4[0-7]):[0-5]\d$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const SESSION_SHARED_FIELDS = Object.freeze(["title", "tag"]);
const SCHEDULE_LOCAL_FIELDS = Object.freeze([
  "dates",
  "all_day",
  "start_time",
  "end_time",
  "end_next_day",
  "is_backup_date",
  "schedule_note",
  "blocked_period",
]);

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  }
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  const fallback = bytes.some(Boolean)
    ? [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return fallback.slice(0, 12).padEnd(12, "0");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyData() {
  return {
    version: 1,
    calendar_name: "卓予定カレンダー",
    description: "GM・PL予定と、仮押さえ・参加不可の日を共有しています。",
    updated_at: "",
    monthly_notes: {},
    events: [],
  };
}

function normalizeScheduleNote(value) {
  return String(value ?? "").trim();
}

function sessionTitleKey(event) {
  if (!isPlainObject(event) || event.tag === "×") return "";
  return String(event.title ?? "").trim();
}

function eventDisplayTitle(event) {
  const tag = String(event?.tag ?? "");
  let title = String(event?.title || "予定名なし").trim() || "予定名なし";
  if (tag === "×") return title;
  const note = normalizeScheduleNote(event?.schedule_note);
  if (note && !title.endsWith(`￤${note}`)) title += `￤${note}`;
  if (event?.is_backup_date && !title.endsWith("￤予備日")) title += "￤予備日";
  return title;
}

function isValidDateText(value) {
  const text = String(value ?? "");
  if (!DATE_PATTERN.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeTimeText(value, maximumHour, pattern, convertMidnight = false) {
  const text = String(value ?? "").trim().replaceAll("：", ":");
  if (!text) return "";
  let hour;
  let minute;
  if (text.includes(":")) {
    const match = text.match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match) return "";
    hour = Number(match[1]);
    minute = Number(match[2]);
  } else if (/^\d+$/.test(text)) {
    if (text.length <= 2) {
      hour = Number(text);
      minute = 0;
    } else if (text.length <= 4) {
      hour = Number(text.slice(0, -2));
      minute = Number(text.slice(-2));
    } else {
      return "";
    }
  } else {
    return "";
  }
  if (hour > maximumHour) return "";
  const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (convertMidnight && normalized === "00:00") return "24:00";
  return pattern.test(normalized) ? normalized : "";
}

function normalizeStartTimeText(value) {
  return normalizeTimeText(value, 23, START_TIME_PATTERN);
}

function normalizeEndTimeText(value) {
  return normalizeTimeText(value, 47, END_TIME_PATTERN, true);
}

function normalizeBlockedPeriod(event) {
  const aliases = {
    all_day: "all_day",
    day: "day",
    night: "night",
    "終日": "all_day",
    "昼": "day",
    "夜": "night",
  };
  const raw = String(event?.blocked_period ?? "").trim();
  if (aliases[raw]) return aliases[raw];
  if (event?.all_day) return "all_day";
  const start = normalizeStartTimeText(event?.start_time);
  if (!start) return "all_day";
  const hour = Number(start.slice(0, 2));
  if (hour >= 18) return "night";
  if (hour >= 12) return "day";
  return "all_day";
}

function usesExtendedEndHour(value) {
  const normalized = normalizeEndTimeText(value);
  return Boolean(normalized) && Number(normalized.slice(0, 2)) >= 24;
}

function automaticallyEndsNextDay(startTime, endTime, allDay = false) {
  if (allDay) return false;
  const start = normalizeStartTimeText(startTime);
  const end = normalizeEndTimeText(endTime);
  if (!start || !end) return false;
  return usesExtendedEndHour(end) || end <= start;
}

function coalesceSameTitleSessions(events) {
  const canonicalIds = new Map();
  for (const event of events) {
    const key = sessionTitleKey(event);
    if (!key) continue;
    const sessionId = String(event.session_id || event.id || createId());
    if (!canonicalIds.has(key)) canonicalIds.set(key, sessionId);
    event.session_id = canonicalIds.get(key);
  }
  return canonicalIds;
}

function uniqueSessionCopyTitle(events, sourceTitle) {
  const existing = new Set(events.map(sessionTitleKey).filter(Boolean));
  const trimmed = String(sourceTitle ?? "").trim();
  const base = trimmed ? `${trimmed}（コピー）` : "コピー";
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) candidate = `${base}${suffix++}`;
  return candidate;
}

function normalizeData(value, options = {}) {
  const idFactory = options.idFactory || createId;
  const input = isPlainObject(value) ? value : {};
  const normalized = emptyData();
  normalized.calendar_name = String(input.calendar_name || normalized.calendar_name);
  normalized.description = String(input.description || "");
  normalized.updated_at = String(input.updated_at || "");

  if (isPlainObject(input.monthly_notes)) {
    for (const [rawKey, rawValue] of Object.entries(input.monthly_notes)) {
      const key = String(rawKey);
      const note = String(rawValue ?? "").trim();
      if (MONTH_PATTERN.test(key) && note) normalized.monthly_notes[key] = note;
    }
  }

  for (const rawEvent of Array.isArray(input.events) ? input.events : []) {
    if (!isPlainObject(rawEvent)) continue;
    const tag = VALID_TAGS.includes(String(rawEvent.tag)) ? String(rawEvent.tag) : "PL";
    const dates = [...new Set(
      (Array.isArray(rawEvent.dates) ? rawEvent.dates : [])
        .map(String)
        .filter(isValidDateText),
    )].sort();
    const rawId = String(rawEvent.id || idFactory());
    const sharedSessionId = String(rawEvent.session_id || rawEvent.id || idFactory());
    const rawBlockedPeriod = String(rawEvent.blocked_period || "").trim();
    const preserveBlockedPeriod = Object.hasOwn(BLOCKED_PERIODS, rawBlockedPeriod);
    const note = normalizeScheduleNote(rawEvent.schedule_note);
    let allDay = Boolean(rawEvent.all_day);
    let startTime = normalizeStartTimeText(rawEvent.start_time);
    let endTime = normalizeEndTimeText(rawEvent.end_time);
    let endNextDay = false;
    let blockedPeriod = "";

    if (tag === "×") {
      blockedPeriod = normalizeBlockedPeriod(rawEvent);
      allDay = blockedPeriod === "all_day";
      startTime = allDay ? "" : BLOCKED_PERIODS[blockedPeriod].startTime;
      endTime = "";
    } else if (tag === "仮押さえ") {
      blockedPeriod = normalizeBlockedPeriod(rawEvent);
      allDay = blockedPeriod === "all_day";
      startTime = allDay ? "" : BLOCKED_PERIODS[blockedPeriod].startTime;
      endTime = "";
    } else {
      if (!START_TIME_PATTERN.test(startTime)) {
        allDay = true;
        startTime = "";
      }
      if (allDay) endTime = "";
      endNextDay = automaticallyEndsNextDay(startTime, endTime, allDay);
    }

    const dateGroups = dates.length ? dates : [[]];
    dateGroups.forEach((dateGroup, index) => {
      const id = index === 0 ? rawId : idFactory();
      const event = {
        id,
        session_id: tag === "×" ? id : sharedSessionId,
        title: tag === "×" ? BLOCKED_PERIODS[blockedPeriod].title : String(rawEvent.title || ""),
        tag,
        dates: [dateGroup].filter(Boolean),
        all_day: allDay,
        start_time: allDay ? "" : startTime,
        end_time: allDay ? "" : endTime,
        end_next_day: allDay ? false : endNextDay,
        is_backup_date: tag === "×" ? false : Boolean(rawEvent.is_backup_date),
      };
      if (tag !== "×" && note) event.schedule_note = note;
      if (PERIOD_TAGS.has(tag)) event.blocked_period = blockedPeriod;
      else if (preserveBlockedPeriod) event.blocked_period = rawBlockedPeriod;
      normalized.events.push(event);
    });
  }

  coalesceSameTitleSessions(normalized.events);
  return normalized;
}

function createScheduleEvents(sessionId, title, tag, dates, scheduleValues, options = {}) {
  const idFactory = options.idFactory || createId;
  const created = [];
  const uniqueDates = [...new Set((dates || []).map(String).filter(isValidDateText))].sort();
  for (const dateText of uniqueDates) {
    const id = idFactory();
    const event = {
      id,
      session_id: tag === "×" ? id : String(sessionId),
      title: String(title),
      tag: String(tag),
      dates: [dateText],
      all_day: Boolean(scheduleValues.all_day),
      start_time: String(scheduleValues.start_time || ""),
      end_time: String(scheduleValues.end_time || ""),
      end_next_day: Boolean(scheduleValues.end_next_day),
      is_backup_date: tag === "×" ? false : Boolean(scheduleValues.is_backup_date),
    };
    if (PERIOD_TAGS.has(tag)) {
      event.blocked_period = String(scheduleValues.blocked_period || "all_day");
    }
    const note = normalizeScheduleNote(scheduleValues.schedule_note);
    if (tag !== "×" && note) event.schedule_note = note;
    created.push(event);
  }
  return created;
}

function updateScheduleFields(event, scheduleValues) {
  for (const field of SCHEDULE_LOCAL_FIELDS) {
    if (field === "schedule_note") {
      if (!Object.hasOwn(scheduleValues, field)) continue;
      const note = normalizeScheduleNote(scheduleValues[field]);
      if (event.tag !== "×" && note) event[field] = note;
      else delete event[field];
      continue;
    }
    if (Object.hasOwn(scheduleValues, field)) event[field] = deepClone(scheduleValues[field]);
    else if (field === "blocked_period") delete event[field];
  }
  return event;
}

function rescheduleScheduleEvent(events, eventId, targetDate, scheduleValues, options = {}) {
  if (!isValidDateText(String(targetDate))) throw new Error("リスケ先の日付が正しくありません。");
  const index = events.findIndex((event) => String(event.id || "") === String(eventId || ""));
  if (index < 0) throw new Error("リスケ元の日程が見つかりません。");
  const source = events[index];
  const rescheduled = deepClone(source);
  rescheduled.id = (options.idFactory || createId)();
  rescheduled.session_id = source.tag === "×"
    ? rescheduled.id
    : String(source.session_id || source.id || "");
  rescheduled.dates = [String(targetDate)];
  updateScheduleFields(rescheduled, scheduleValues);
  if (source.tag === "×") {
    const period = String(scheduleValues.blocked_period || "all_day");
    rescheduled.title = BLOCKED_PERIODS[period]?.title || BLOCKED_PERIODS.all_day.title;
    rescheduled.is_backup_date = false;
  }
  events[index] = rescheduled;
  return rescheduled;
}

function updateSessionFields(events, sessionId, title, tag) {
  const changed = [];
  for (const event of events) {
    if (String(event.session_id || event.id || "") !== String(sessionId)) continue;
    event.title = String(title);
    event.tag = String(tag);
    changed.push(event);
  }
  return changed;
}

function duplicateSessionEvents(events, sessionId, copyTitle, options = {}) {
  const idFactory = options.idFactory || createId;
  const newSessionId = idFactory();
  const duplicates = [];
  for (const source of events) {
    if (String(source.session_id || source.id || "") !== String(sessionId)) continue;
    const duplicate = deepClone(source);
    duplicate.id = idFactory();
    duplicate.session_id = newSessionId;
    duplicate.title = String(copyTitle);
    duplicate.dates = [...(source.dates || [])];
    duplicates.push(duplicate);
  }
  return [newSessionId, duplicates];
}

function formatEventTime(event) {
  if (event.tag === "×") return "";
  if (event.tag === "仮押さえ") {
    return BLOCKED_PERIODS[normalizeBlockedPeriod(event)].holdLabel;
  }
  if (event.all_day || !event.start_time) return "終日";
  if (!event.end_time) return event.start_time;
  const next = event.end_next_day && !usesExtendedEndHour(event.end_time) ? "翌" : "";
  return `${event.start_time}–${next}${event.end_time}`;
}

function validateCalendarData(value) {
  const errors = [];
  if (!isPlainObject(value)) return ["ルートはオブジェクトである必要があります。"];
  if (value.version !== undefined && value.version !== 1) errors.push("version は 1 である必要があります。");
  if (value.calendar_name !== undefined && typeof value.calendar_name !== "string") errors.push("calendar_name は文字列である必要があります。");
  if (value.description !== undefined && typeof value.description !== "string") errors.push("description は文字列である必要があります。");
  if (value.updated_at !== undefined && typeof value.updated_at !== "string") errors.push("updated_at は文字列である必要があります。");
  if (!isPlainObject(value.monthly_notes)) {
    errors.push("monthly_notes はオブジェクトである必要があります。");
  } else {
    for (const [month, note] of Object.entries(value.monthly_notes)) {
      if (!MONTH_PATTERN.test(month)) errors.push(`monthly_notes.${month} の月形式が不正です。`);
      if (typeof note !== "string") errors.push(`monthly_notes.${month} は文字列である必要があります。`);
    }
  }
  if (!Array.isArray(value.events)) return [...errors, "events は配列である必要があります。"];
  const ids = new Set();
  value.events.forEach((event, index) => {
    const path = `events[${index}]`;
    if (!isPlainObject(event)) {
      errors.push(`${path} はオブジェクトである必要があります。`);
      return;
    }
    if (!EVENT_ID_PATTERN.test(String(event.id || ""))) errors.push(`${path}.id が不正です。`);
    else if (ids.has(String(event.id))) errors.push(`${path}.id が重複しています。`);
    else ids.add(String(event.id));
    if (!EVENT_ID_PATTERN.test(String(event.session_id || ""))) errors.push(`${path}.session_id が不正です。`);
    if (!VALID_TAGS.includes(event.tag)) errors.push(`${path}.tag が不正です。`);
    if (typeof event.title !== "string" || (!event.title.trim() && event.tag !== "×")) errors.push(`${path}.title が不正です。`);
    if (!Array.isArray(event.dates) || !event.dates.length) errors.push(`${path}.dates は1件以上必要です。`);
    else if (event.dates.some((date) => !isValidDateText(date))) errors.push(`${path}.dates に不正な日付があります。`);
    if (typeof event.all_day !== "boolean") errors.push(`${path}.all_day は真偽値である必要があります。`);
    if (typeof event.end_next_day !== "boolean") errors.push(`${path}.end_next_day は真偽値である必要があります。`);
    if (typeof event.is_backup_date !== "boolean") errors.push(`${path}.is_backup_date は真偽値である必要があります。`);
    if (event.schedule_note !== undefined && typeof event.schedule_note !== "string") errors.push(`${path}.schedule_note は文字列である必要があります。`);
    if (event.blocked_period !== undefined && !Object.hasOwn(BLOCKED_PERIODS, event.blocked_period)) errors.push(`${path}.blocked_period が不正です。`);
    if (event.tag === "GM" || event.tag === "PL") {
      if (!event.all_day && !START_TIME_PATTERN.test(String(event.start_time || ""))) errors.push(`${path}.start_time が不正です。`);
      if (event.end_time && !END_TIME_PATTERN.test(String(event.end_time))) errors.push(`${path}.end_time が不正です。`);
    }
    if (PERIOD_TAGS.has(event.tag) && event.blocked_period !== undefined && !Object.hasOwn(BLOCKED_PERIODS, event.blocked_period)) {
      errors.push(`${path}.blocked_period が不正です。`);
    }
  });
  return errors;
}

function japanTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function prepareCalendarForSave(value, date = new Date()) {
  const normalized = normalizeData(value);
  normalized.version = 1;
  normalized.updated_at = japanTimestamp(date);
  return normalized;
}

function serializeCalendarData(value, date = new Date()) {
  return `${JSON.stringify(prepareCalendarForSave(value, date), null, 2)}\n`;
}

export {
  BLOCKED_PERIODS,
  END_TIME_PATTERN,
  MONTH_PATTERN,
  PERIOD_TAGS,
  SESSION_SHARED_FIELDS,
  SCHEDULE_LOCAL_FIELDS,
  START_TIME_PATTERN,
  VALID_TAGS,
  automaticallyEndsNextDay,
  coalesceSameTitleSessions,
  createId,
  createScheduleEvents,
  deepClone,
  duplicateSessionEvents,
  emptyData,
  eventDisplayTitle,
  formatEventTime,
  isValidDateText,
  japanTimestamp,
  normalizeBlockedPeriod,
  normalizeData,
  normalizeEndTimeText,
  normalizeScheduleNote,
  normalizeStartTimeText,
  prepareCalendarForSave,
  rescheduleScheduleEvent,
  serializeCalendarData,
  sessionTitleKey,
  uniqueSessionCopyTitle,
  updateScheduleFields,
  updateSessionFields,
  usesExtendedEndHour,
  validateCalendarData,
};
