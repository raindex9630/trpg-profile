import {
  BLOCKED_PERIODS,
  VALID_TAGS,
  automaticallyEndsNextDay,
  coalesceSameTitleSessions,
  createId,
  createScheduleEvents,
  deepClone,
  duplicateSessionEvents,
  eventDisplayTitle,
  formatEventTime,
  normalizeBlockedPeriod,
  normalizeData,
  normalizeEndTimeText,
  normalizeStartTimeText,
  rescheduleScheduleEvent,
  uniqueSessionCopyTitle,
  updateScheduleFields,
  updateSessionFields,
} from "./calendar-core.js";

const TAG_CLASSES = {
  GM: "tag-gm",
  PL: "tag-pl",
  "仮押さえ": "tag-hold",
  "×": "tag-blocked",
};
const HISTORY_LIMIT = 100;
const state = {
  data: null,
  baseSha: "",
  savedSignature: "",
  dirty: false,
  pendingForms: new Set(),
  undo: [],
  redo: [],
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
  selectedSessionId: null,
  selectedEventId: null,
  mode: "idle",
  selectedDates: new Set(),
  modeContext: {},
  loading: false,
};

const elements = Object.fromEntries([
  "workspace", "status", "dirty-indicator", "form-indicator", "undo-button", "redo-button",
  "download-button", "reload-button", "save-button", "conflict-panel", "conflict-download-button",
  "conflict-reload-button", "new-session-button", "new-blocked-button", "session-list", "session-count",
  "empty-sessions", "previous-month-button", "next-month-button", "today-button", "month-input",
  "month-heading", "selection-guide", "calendar-grid", "month-note-form", "month-note-label", "month-note",
  "cancel-mode-button", "mode-panel", "mode-label", "create-form", "create-session-fields", "create-title",
  "create-tag", "create-target-session", "selected-dates-summary", "create-apply-button", "empty-detail",
  "session-section", "selected-session-tag", "session-form", "session-title", "session-tag",
  "add-schedule-button", "duplicate-session-button", "delete-session-button", "schedule-list",
  "schedule-section", "selected-schedule-date", "schedule-form", "duplicate-schedule-button",
  "reschedule-button", "delete-schedule-button", "settings-form", "calendar-name", "calendar-description",
  "schedule-fields-template",
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

for (const scope of ["create", "edit"]) {
  const target = document.querySelector(`[data-schedule-fields="${scope}"]`);
  target.append(elements.schedule_fields_template.content.cloneNode(true));
  target.dataset.scope = scope;
}

function scheduleFieldRoot(scope) {
  return document.querySelector(`[data-schedule-fields="${scope}"]`);
}

function scheduleFields(scope) {
  const root = scheduleFieldRoot(scope);
  return {
    root,
    periodFields: root.querySelector(".period-fields"),
    regularFields: root.querySelector(".regular-fields"),
    backupField: root.querySelector(".backup-field"),
    noteField: root.querySelector(".note-field"),
    period: root.querySelector('[data-field="blocked-period"]'),
    allDay: root.querySelector('[data-field="all-day"]'),
    start: root.querySelector('[data-field="start-time"]'),
    end: root.querySelector('[data-field="end-time"]'),
    backup: root.querySelector('[data-field="backup"]'),
    note: root.querySelector('[data-field="schedule-note"]'),
  };
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date = state.currentMonth) {
  return localDateKey(date).slice(0, 7);
}

function parseDateKey(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function escapeSelectorValue(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

const JapaneseHolidays = (() => {
  const cache = new Map();
  const key = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const nthMonday = (year, month, nth) => {
    const first = new Date(year, month - 1, 1, 12);
    return 1 + ((8 - first.getDay()) % 7) + ((nth - 1) * 7);
  };
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
  function forYear(year) {
    if (cache.has(year)) return cache.get(year);
    const national = new Set();
    const add = (month, day) => national.add(key(year, month, day));
    if (year < 2000 || year > 2099) return national;
    add(1, 1); add(1, nthMonday(year, 1, 2)); add(2, 11);
    if (year >= 2020) add(2, 23);
    if (year <= 2018) add(12, 23);
    add(3, Math.floor(20.8431 + .242194 * (year - 1980) - Math.floor((year - 1980) / 4)));
    add(4, 29); add(5, 3); add(5, 4); add(5, 5);
    if (year === 2020) { add(7, 23); add(7, 24); add(8, 10); }
    else if (year === 2021) { add(7, 22); add(7, 23); add(8, 8); }
    else {
      add(7, year >= 2003 ? nthMonday(year, 7, 3) : 20);
      if (year >= 2016) add(8, 11);
      add(10, nthMonday(year, 10, 2));
    }
    add(9, year >= 2003 ? nthMonday(year, 9, 3) : 15);
    add(9, Math.floor(23.2488 + .242194 * (year - 1980) - Math.floor((year - 1980) / 4)));
    add(11, 3); add(11, 23);
    if (year === 2019) { add(5, 1); add(10, 22); }
    const holidays = new Set(national);
    for (let cursor = new Date(year, 0, 2, 12); cursor <= new Date(year, 11, 30, 12); cursor = addDays(cursor, 1)) {
      const current = localDateKey(cursor);
      if (!national.has(current) && national.has(localDateKey(addDays(cursor, -1))) && national.has(localDateKey(addDays(cursor, 1)))) holidays.add(current);
    }
    [...national].sort().forEach((holidayKey) => {
      const holiday = parseDateKey(holidayKey);
      if (holiday.getDay() !== 0) return;
      let substitute = addDays(holiday, 1);
      while (holidays.has(localDateKey(substitute))) substitute = addDays(substitute, 1);
      holidays.add(localDateKey(substitute));
    });
    cache.set(year, holidays);
    return holidays;
  }
  return { has: (value) => forYear(Number(String(value).slice(0, 4))).has(value) };
})();

function signature(data) {
  return JSON.stringify(data);
}

function setStatus(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "不明なエラーです。");
}

function markPending(form) {
  if (!state.data) return;
  state.pendingForms.add(form);
  updateStateIndicators();
}

function clearPending(form) {
  state.pendingForms.delete(form);
  updateStateIndicators();
}

function clearAllPending() {
  state.pendingForms.clear();
  updateStateIndicators();
}

function updateStateIndicators() {
  state.dirty = Boolean(state.data) && signature(state.data) !== state.savedSignature;
  const indicator = elements.dirty_indicator;
  indicator.classList.toggle("is-dirty", state.dirty);
  indicator.classList.toggle("is-saved", Boolean(state.data) && !state.dirty);
  indicator.textContent = state.loading ? "読込中" : state.dirty ? "GitHubへ未保存" : state.data ? "保存済み" : "未読込";
  elements.form_indicator.hidden = state.pendingForms.size === 0;
  elements.undo_button.disabled = !state.undo.length || state.loading;
  elements.redo_button.disabled = !state.redo.length || state.loading;
  elements.download_button.disabled = !state.data;
  elements.save_button.disabled = !state.data || !state.baseSha || !state.dirty || state.loading;
}

function selectedEvent() {
  return state.data?.events.find((event) => event.id === state.selectedEventId) || null;
}

function selectedSessionEvents() {
  if (!state.selectedSessionId) return [];
  return state.data.events.filter((event) => event.session_id === state.selectedSessionId);
}

function selectedSession() {
  return selectedSessionEvents().find((event) => event.tag !== "×") || null;
}

function eventDate(event) {
  return event?.dates?.[0] || "";
}

function compareEvents(left, right) {
  const leftTime = left.tag === "×" || left.tag === "仮押さえ"
    ? BLOCKED_PERIODS[normalizeBlockedPeriod(left)].startTime
    : left.start_time || "00:00";
  const rightTime = right.tag === "×" || right.tag === "仮押さえ"
    ? BLOCKED_PERIODS[normalizeBlockedPeriod(right)].startTime
    : right.start_time || "00:00";
  return leftTime.localeCompare(rightTime) || eventDisplayTitle(left).localeCompare(eventDisplayTitle(right), "ja");
}

function tagChip(tag) {
  const span = document.createElement("span");
  span.className = `tag-chip ${TAG_CLASSES[tag] || ""}`;
  span.textContent = tag === "×" ? "予定アリ" : tag;
  return span;
}

function recordMutation(label, mutate) {
  const before = deepClone(state.data);
  mutate(state.data);
  if (signature(before) === signature(state.data)) {
    setStatus("変更はありませんでした。", "info");
    return false;
  }
  state.undo.push({ label, data: before });
  if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
  state.redo = [];
  elements.conflict_panel.hidden = true;
  updateStateIndicators();
  renderAll();
  setStatus(`✓ ${label}を反映しました。GitHubへの保存はまだ行われていません。`, "success");
  return true;
}

function undo() {
  const entry = state.undo.pop();
  if (!entry) return;
  state.redo.push({ label: entry.label, data: deepClone(state.data) });
  state.data = entry.data;
  clearAllPending();
  ensureValidSelection();
  renderAll({ forceForms: true });
  setStatus(`「${entry.label}」を元に戻しました。`, "success");
}

function redo() {
  const entry = state.redo.pop();
  if (!entry) return;
  state.undo.push({ label: entry.label, data: deepClone(state.data) });
  state.data = entry.data;
  clearAllPending();
  ensureValidSelection();
  renderAll({ forceForms: true });
  setStatus(`「${entry.label}」をやり直しました。`, "success");
}

function ensureValidSelection() {
  if (state.selectedEventId && !selectedEvent()) state.selectedEventId = null;
  if (state.selectedSessionId && !selectedSessionEvents().length) state.selectedSessionId = null;
}

function monthSessions() {
  const key = monthKey();
  const groups = new Map();
  for (const event of state.data.events) {
    if (event.tag === "×" || !eventDate(event).startsWith(key)) continue;
    if (!groups.has(event.session_id)) groups.set(event.session_id, { event, dates: new Set() });
    groups.get(event.session_id).dates.add(eventDate(event));
  }
  return [...groups.values()].sort((a, b) => a.event.tag.localeCompare(b.event.tag, "ja") || a.event.title.localeCompare(b.event.title, "ja"));
}

function renderSessions() {
  const sessions = monthSessions();
  elements.session_list.replaceChildren();
  elements.session_count.textContent = String(sessions.length);
  elements.empty_sessions.hidden = sessions.length > 0;
  for (const group of sessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-item";
    button.dataset.sessionId = group.event.session_id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(state.selectedSessionId === group.event.session_id));
    const chip = tagChip(group.event.tag);
    const name = document.createElement("span");
    name.className = "session-item-name";
    name.textContent = group.event.title;
    const days = document.createElement("span");
    days.className = "session-item-days";
    days.textContent = String(group.dates.size);
    button.append(chip, name, days);
    elements.session_list.append(button);
  }
}

function eventsOnDate(dateKey) {
  return state.data.events.filter((event) => event.dates.includes(dateKey)).sort(compareEvents);
}

function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const key = monthKey();
  elements.month_heading.textContent = `${year}年${month + 1}月`;
  elements.month_input.value = key;
  elements.month_note_label.textContent = `${year}年${month + 1}月のメモ`;
  if (!state.pendingForms.has("month")) elements.month_note.value = state.data.monthly_notes[key] || "";
  elements.calendar_grid.replaceChildren();
  const days = new Date(year, month + 1, 0, 12).getDate();
  const leading = (new Date(year, month, 1, 12).getDay() + 6) % 7;
  const total = Math.ceil((leading + days) / 7) * 7;
  const todayKey = localDateKey(new Date());
  for (let cellIndex = 0; cellIndex < total; cellIndex += 1) {
    const day = cellIndex - leading + 1;
    if (day < 1 || day > days) {
      const empty = document.createElement("div");
      empty.className = "calendar-empty";
      empty.setAttribute("aria-hidden", "true");
      elements.calendar_grid.append(empty);
      continue;
    }
    const date = new Date(year, month, day, 12);
    const dateKey = localDateKey(date);
    const dayEvents = eventsOnDate(dateKey);
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    cell.dataset.date = dateKey;
    cell.setAttribute("role", "gridcell");
    cell.tabIndex = 0;
    cell.setAttribute("aria-label", `${year}年${month + 1}月${day}日。${dayEvents.length}件の予定`);
    if (date.getDay() === 6) cell.classList.add("is-saturday");
    if (date.getDay() === 0 || JapaneseHolidays.has(dateKey)) cell.classList.add("is-holiday");
    if (dateKey === todayKey) cell.classList.add("is-today");
    if (state.selectedDates.has(dateKey)) cell.classList.add("is-selected");
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(day);
    const eventWrap = document.createElement("div");
    eventWrap.className = "day-events";
    dayEvents.forEach((event) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `event-button ${TAG_CLASSES[event.tag] || ""}`;
      button.dataset.eventId = event.id;
      button.classList.toggle("is-selected", event.id === state.selectedEventId);
      button.setAttribute("aria-label", [event.tag, eventDisplayTitle(event), formatEventTime(event)].filter(Boolean).join(" "));
      const title = document.createElement("span");
      title.className = "event-title";
      title.textContent = eventDisplayTitle(event);
      button.append(title);
      const time = formatEventTime(event);
      if (time) {
        const timeSpan = document.createElement("span");
        timeSpan.className = "event-time";
        timeSpan.textContent = time;
        button.append(timeSpan);
      }
      eventWrap.append(button);
    });
    cell.append(number, eventWrap);
    elements.calendar_grid.append(cell);
  }
  renderSelectionGuide();
}

function renderSelectionGuide() {
  const active = state.mode !== "idle";
  elements.selection_guide.classList.toggle("is-active", active);
  if (!active) {
    elements.selection_guide.textContent = "日程を選ぶと右側で編集できます。";
    return;
  }
  const single = state.mode === "reschedule";
  elements.selection_guide.textContent = single
    ? "リスケ先を1日選択してください。"
    : "追加する日付を選択してください。複数日を選べます。";
}

function configureScheduleFields(scope, tag, values = null) {
  const fields = scheduleFields(scope);
  const period = tag === "仮押さえ" || tag === "×";
  fields.periodFields.hidden = !period;
  fields.regularFields.hidden = period;
  fields.backupField.hidden = tag === "×";
  fields.noteField.hidden = tag === "×";
  if (values) {
    fields.period.value = normalizeBlockedPeriod(values);
    fields.allDay.checked = Boolean(values.all_day);
    fields.start.value = values.start_time || "21:00";
    fields.end.value = values.end_time || "24:00";
    fields.backup.checked = tag === "×" ? false : Boolean(values.is_backup_date);
    fields.note.value = tag === "×" ? "" : values.schedule_note || "";
  }
  fields.start.disabled = fields.allDay.checked;
  fields.end.disabled = fields.allDay.checked;
}

function defaultScheduleValues() {
  return { all_day: false, start_time: "21:00", end_time: "24:00", end_next_day: true, is_backup_date: false, schedule_note: "", blocked_period: "all_day" };
}

function readScheduleValues(scope, tag) {
  const fields = scheduleFields(scope);
  if (tag === "仮押さえ" || tag === "×") {
    const period = fields.period.value;
    const definition = BLOCKED_PERIODS[period];
    if (!definition) throw new Error("区分を選択してください。");
    return {
      all_day: period === "all_day",
      start_time: period === "all_day" ? "" : definition.startTime,
      end_time: "",
      end_next_day: false,
      is_backup_date: tag === "×" ? false : fields.backup.checked,
      schedule_note: tag === "×" ? "" : fields.note.value.trim(),
      blocked_period: period,
    };
  }
  const allDay = fields.allDay.checked;
  let start = "";
  let end = "";
  if (!allDay) {
    start = normalizeStartTimeText(fields.start.value);
    if (!start) throw new Error("開始時刻は00:00から23:59で入力してください。");
    if (fields.end.value.trim()) {
      end = normalizeEndTimeText(fields.end.value);
      if (!end) throw new Error("終了時刻は00:00から47:59で入力してください。");
    }
    fields.start.value = start;
    fields.end.value = end;
  }
  return {
    all_day: allDay,
    start_time: start,
    end_time: end,
    end_next_day: automaticallyEndsNextDay(start, end, allDay),
    is_backup_date: fields.backup.checked,
    schedule_note: fields.note.value.trim(),
  };
}

function renderMode(options = {}) {
  const active = state.mode !== "idle";
  elements.mode_panel.hidden = !active;
  elements.cancel_mode_button.hidden = !active;
  if (!active) return;
  const session = selectedSession();
  const labels = {
    "new-session": "新しいセッションを追加",
    "new-blocked": "予定アリを追加",
    "add-schedule": "既存セッションへ日程を追加",
    "duplicate-schedule": "日程を複製",
    reschedule: "選択した日程をリスケ",
  };
  elements.mode_label.textContent = labels[state.mode];
  const needsSessionFields = state.mode === "new-session";
  elements.create_session_fields.hidden = !needsSessionFields;
  elements.create_target_session.hidden = needsSessionFields || state.mode === "new-blocked";
  if (!elements.create_target_session.hidden) {
    elements.create_target_session.textContent = session ? `${session.tag}｜${session.title}` : "対象セッションなし";
  }
  let tag = "×";
  if (state.mode === "new-session") tag = elements.create_tag.value;
  else if (state.mode !== "new-blocked") tag = session?.tag || selectedEvent()?.tag || "PL";
  if (options.forceForms || !state.pendingForms.has("create")) {
    if (state.mode === "new-session") {
      elements.create_title.value = "";
      elements.create_tag.value = "";
      tag = "";
    }
    configureScheduleFields("create", tag, state.modeContext.scheduleValues || defaultScheduleValues());
  } else {
    configureScheduleFields("create", tag);
  }
  elements.create_apply_button.textContent = state.mode === "reschedule" ? "リスケを反映" : state.mode === "new-session" ? "新しいセッションとして追加" : state.mode === "new-blocked" ? "予定アリを追加" : "日程を追加";
  renderSelectedDatesSummary();
}

function renderSelectedDatesSummary() {
  const dates = [...state.selectedDates].sort();
  elements.selected_dates_summary.textContent = dates.length ? `選択中：${dates.join("、")}` : "日付が選択されていません。";
}

function renderDetails(options = {}) {
  const session = selectedSession();
  const event = selectedEvent();
  const hasMode = state.mode !== "idle";
  elements.empty_detail.hidden = hasMode || Boolean(session) || Boolean(event);
  elements.session_section.hidden = !session;
  elements.schedule_section.hidden = !event || hasMode;

  if (session) {
    elements.selected_session_tag.className = `tag-chip ${TAG_CLASSES[session.tag] || ""}`;
    elements.selected_session_tag.textContent = session.tag;
    if (options.forceForms || !state.pendingForms.has("session")) {
      elements.session_title.value = session.title;
      elements.session_tag.value = session.tag;
    }
    elements.schedule_list.replaceChildren();
    selectedSessionEvents().sort((a, b) => eventDate(a).localeCompare(eventDate(b)) || compareEvents(a, b)).forEach((schedule) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "schedule-item";
      button.dataset.eventId = schedule.id;
      button.setAttribute("aria-pressed", String(schedule.id === state.selectedEventId));
      const date = document.createElement("span");
      date.className = "schedule-date";
      date.textContent = eventDate(schedule);
      const summary = document.createElement("span");
      summary.className = "schedule-summary";
      summary.textContent = [formatEventTime(schedule), schedule.schedule_note, schedule.is_backup_date ? "予備日" : ""].filter(Boolean).join("｜") || "終日";
      const arrow = document.createElement("span");
      arrow.textContent = "›";
      button.append(date, summary, arrow);
      elements.schedule_list.append(button);
    });
  }
  if (event && !hasMode) {
    elements.selected_schedule_date.textContent = eventDate(event);
    elements.selected_schedule_date.dateTime = eventDate(event);
    if (options.forceForms || !state.pendingForms.has("schedule")) configureScheduleFields("edit", event.tag, event);
    else configureScheduleFields("edit", event.tag);
  }
  if (options.forceForms || !state.pendingForms.has("settings")) {
    elements.calendar_name.value = state.data.calendar_name;
    elements.calendar_description.value = state.data.description;
  }
  renderMode(options);
}

function renderAll(options = {}) {
  if (!state.data) return;
  renderSessions();
  renderCalendar();
  renderDetails(options);
  updateStateIndicators();
}

function changeMonth(offset) {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + offset, 1, 12);
  clearPending("month");
  renderAll({ forceForms: false });
}

function setMonth(value) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return;
  const [year, month] = value.split("-").map(Number);
  state.currentMonth = new Date(year, month - 1, 1, 12);
  clearPending("month");
  renderAll({ forceForms: false });
}

function cancelMode({ quiet = false } = {}) {
  state.mode = "idle";
  state.modeContext = {};
  state.selectedDates.clear();
  clearPending("create");
  renderAll({ forceForms: true });
  if (!quiet) setStatus("追加・リスケ操作をキャンセルしました。", "info");
}

function enterMode(mode, context = {}) {
  state.mode = mode;
  state.modeContext = context;
  state.selectedDates = new Set();
  clearPending("create");
  renderAll({ forceForms: true });
  elements.mode_panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function toggleDateSelection(dateKey) {
  if (state.mode === "idle") return;
  if (state.mode === "reschedule") {
    state.selectedDates = state.selectedDates.has(dateKey) ? new Set() : new Set([dateKey]);
  } else if (state.selectedDates.has(dateKey)) state.selectedDates.delete(dateKey);
  else state.selectedDates.add(dateKey);
  renderCalendar();
  renderSelectedDatesSummary();
}

function selectSession(sessionId) {
  if (state.selectedSessionId === sessionId && state.mode === "idle") {
    state.selectedSessionId = null;
    state.selectedEventId = null;
  } else {
    state.selectedSessionId = sessionId;
    state.selectedEventId = null;
  }
  state.mode = "idle";
  state.selectedDates.clear();
  clearAllPending();
  renderAll({ forceForms: true });
}

function selectEvent(eventId) {
  const event = state.data.events.find((item) => item.id === eventId);
  if (!event) return;
  state.selectedEventId = state.selectedEventId === eventId && state.mode === "idle" ? null : eventId;
  state.selectedSessionId = state.selectedEventId ? event.session_id : event.tag === "×" ? null : event.session_id;
  state.mode = "idle";
  state.selectedDates.clear();
  clearAllPending();
  renderAll({ forceForms: true });
}

async function readApiResponse(response) {
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`サーバー応答を読み取れませんでした（HTTP ${response.status}）。`); }
  if (!response.ok) {
    const error = new Error(body?.error?.message || `APIエラー（HTTP ${response.status}）`);
    error.code = body?.error?.code;
    error.status = response.status;
    error.details = body?.error?.details;
    throw error;
  }
  return body;
}

async function loadCalendar({ initial = false } = {}) {
  if (!initial && (state.dirty || state.pendingForms.size) && !window.confirm("未保存・未反映の内容を破棄してGitHubの最新版を読み込みますか？")) return;
  state.loading = true;
  updateStateIndicators();
  setStatus("GitHubから最新版を読み込んでいます…", "info");
  try {
    const response = await fetch("/api/calendar", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiResponse(response);
    state.data = normalizeData(payload.data);
    state.baseSha = payload.sha;
    state.savedSignature = signature(state.data);
    state.undo = [];
    state.redo = [];
    state.selectedSessionId = null;
    state.selectedEventId = null;
    state.mode = "idle";
    state.selectedDates.clear();
    state.pendingForms.clear();
    elements.conflict_panel.hidden = true;
    elements.workspace.hidden = false;
    renderAll({ forceForms: true });
    setStatus("GitHubの最新版を読み込みました。フォームの反映後、上部の保存でコミットします。", "success");
  } catch (error) {
    setStatus(`読込に失敗しました：${errorMessage(error)}`, "error");
  } finally {
    state.loading = false;
    updateStateIndicators();
  }
}

async function saveCalendar() {
  if (!state.data || !state.dirty || state.loading) return;
  if (state.pendingForms.size && !window.confirm("未反映のフォーム内容は保存されません。反映済みデータだけをGitHubへ保存しますか？")) {
    setStatus("保存を中止しました。先に各フォームの反映ボタンを押してください。", "warning");
    return;
  }
  state.loading = true;
  const hadPendingForms = state.pendingForms.size > 0;
  updateStateIndicators();
  setStatus("反映済みデータをGitHubへ保存しています…", "info");
  try {
    const response = await fetch("/api/calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseSha: state.baseSha, data: state.data }),
    });
    const payload = await readApiResponse(response);
    state.data = normalizeData(payload.data);
    state.baseSha = payload.sha;
    state.savedSignature = signature(state.data);
    state.undo = [];
    state.redo = [];
    if (!hadPendingForms) clearAllPending();
    elements.conflict_panel.hidden = true;
    renderAll({ forceForms: !hadPendingForms });
    const commitSuffix = payload.commitUrl ? ` コミット：${payload.commitUrl}` : "";
    const pendingNotice = hadPendingForms ? " 未反映のフォーム内容は保存されておらず、入力欄に保持しています。" : "";
    setStatus(`GitHubへ保存しました。公開反映はCloudflare Pagesのデプロイ後です。${pendingNotice}${commitSuffix}`, "success");
  } catch (error) {
    if (error.status === 409 || error.code === "SHA_CONFLICT" || error.code === "GITHUB_UPDATE_CONFLICT") {
      elements.conflict_panel.hidden = false;
      setStatus("保存できませんでした。別の場所で更新されています。編集中の内容は保持しています。", "warning");
    } else {
      setStatus(`保存に失敗しました。編集中の内容は保持しています：${errorMessage(error)}`, "error");
    }
  } finally {
    state.loading = false;
    updateStateIndicators();
  }
}

function downloadJson() {
  if (!state.data) return;
  const blob = new Blob([`${JSON.stringify(state.data, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `calendar-edit-backup-${localDateKey(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("編集中のJSONをダウンロードしました。", "success");
}

elements.session_list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");
  if (button) selectSession(button.dataset.sessionId);
});
elements.schedule_list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-id]");
  if (button) selectEvent(button.dataset.eventId);
});
elements.calendar_grid.addEventListener("click", (event) => {
  const eventButton = event.target.closest("[data-event-id]");
  if (eventButton && state.mode === "idle") { selectEvent(eventButton.dataset.eventId); return; }
  const day = event.target.closest("[data-date]");
  if (day) toggleDateSelection(day.dataset.date);
});
elements.calendar_grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const day = event.target.closest("[data-date]");
  if (!day) return;
  event.preventDefault();
  toggleDateSelection(day.dataset.date);
});

elements.new_session_button.addEventListener("click", () => {
  state.selectedSessionId = null;
  state.selectedEventId = null;
  enterMode("new-session", { scheduleValues: defaultScheduleValues() });
});
elements.new_blocked_button.addEventListener("click", () => {
  state.selectedSessionId = null;
  state.selectedEventId = null;
  enterMode("new-blocked", { scheduleValues: defaultScheduleValues() });
});
elements.add_schedule_button.addEventListener("click", () => enterMode("add-schedule", { scheduleValues: defaultScheduleValues() }));
elements.cancel_mode_button.addEventListener("click", () => cancelMode());

elements.create_tag.addEventListener("change", () => {
  configureScheduleFields("create", elements.create_tag.value);
  markPending("create");
});

elements.create_form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const dates = [...state.selectedDates].sort();
    if (!dates.length) throw new Error(state.mode === "reschedule" ? "リスケ先を1日選択してください。" : "追加する日付を1日以上選択してください。");
    let tag;
    let title;
    let sessionId;
    if (state.mode === "new-session") {
      title = elements.create_title.value.trim();
      tag = elements.create_tag.value;
      if (!title) throw new Error("セッション名を入力してください。");
      if (!VALID_TAGS.slice(0, 3).includes(tag)) throw new Error("種別を選択してください。");
      const existing = state.data.events.find((item) => item.tag !== "×" && item.title.trim() === title);
      sessionId = existing?.session_id || createId();
    } else if (state.mode === "new-blocked") {
      tag = "×";
      sessionId = "";
      title = "×";
    } else {
      const source = selectedSession() || selectedEvent();
      if (!source) throw new Error("対象の日程が見つかりません。");
      tag = source.tag;
      title = source.title;
      sessionId = source.session_id;
    }
    const values = readScheduleValues("create", tag);
    if (tag === "×") title = BLOCKED_PERIODS[values.blocked_period].title;
    if (state.mode === "reschedule") {
      if (dates.length !== 1) throw new Error("リスケ先は1日だけ選択してください。");
      const sourceId = state.modeContext.sourceEventId;
      let movedId = "";
      recordMutation("日程のリスケ", (data) => {
        movedId = rescheduleScheduleEvent(data.events, sourceId, dates[0], values).id;
      });
      state.selectedEventId = movedId;
      state.mode = "idle";
      state.selectedDates.clear();
      clearPending("create");
      renderAll({ forceForms: true });
      return;
    }
    let newSessionId = sessionId;
    recordMutation(state.mode === "new-session" ? "セッションの追加" : tag === "×" ? "予定アリの追加" : state.mode === "duplicate-schedule" ? "日程の複製" : "日程の追加", (data) => {
      const created = createScheduleEvents(sessionId, title, tag, dates, values);
      data.events.push(...created);
      coalesceSameTitleSessions(data.events);
      if (tag !== "×") newSessionId = created[0]?.session_id || sessionId;
    });
    state.selectedSessionId = tag === "×" ? null : newSessionId;
    state.selectedEventId = null;
    state.mode = "idle";
    state.selectedDates.clear();
    clearPending("create");
    renderAll({ forceForms: true });
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
});

elements.session_form.addEventListener("submit", (event) => {
  event.preventDefault();
  const session = selectedSession();
  const title = elements.session_title.value.trim();
  const tag = elements.session_tag.value;
  if (!session || !title || !VALID_TAGS.slice(0, 3).includes(tag)) {
    setStatus("セッション名と種別を確認してください。", "error");
    return;
  }
  recordMutation("セッション情報の変更", (data) => {
    updateSessionFields(data.events, session.session_id, title, tag);
    coalesceSameTitleSessions(data.events);
    state.selectedSessionId = data.events.find((item) => item.tag !== "×" && item.title.trim() === title)?.session_id || session.session_id;
  });
  clearPending("session");
  renderAll({ forceForms: true });
});

elements.duplicate_session_button.addEventListener("click", () => {
  const session = selectedSession();
  if (!session) return;
  const copyTitle = uniqueSessionCopyTitle(state.data.events, session.title);
  let newSessionId;
  recordMutation("セッションの複製", (data) => {
    const result = duplicateSessionEvents(data.events, session.session_id, copyTitle);
    newSessionId = result[0];
    data.events.push(...result[1]);
  });
  state.selectedSessionId = newSessionId;
  state.selectedEventId = null;
  renderAll({ forceForms: true });
});

elements.delete_session_button.addEventListener("click", () => {
  const session = selectedSession();
  if (!session || !window.confirm(`セッション「${session.title}」と全日程を削除しますか？`)) return;
  recordMutation("セッションの削除", (data) => {
    data.events = data.events.filter((item) => item.session_id !== session.session_id);
  });
  state.selectedSessionId = null;
  state.selectedEventId = null;
  renderAll({ forceForms: true });
});

elements.schedule_form.addEventListener("submit", (event) => {
  event.preventDefault();
  const schedule = selectedEvent();
  if (!schedule) return;
  try {
    const values = readScheduleValues("edit", schedule.tag);
    recordMutation("日程の変更", (data) => {
      const target = data.events.find((item) => item.id === schedule.id);
      updateScheduleFields(target, values);
      if (target.tag === "×") target.title = BLOCKED_PERIODS[values.blocked_period].title;
    });
    clearPending("schedule");
    renderAll({ forceForms: true });
  } catch (error) {
    setStatus(errorMessage(error), "error");
  }
});

elements.duplicate_schedule_button.addEventListener("click", () => {
  const schedule = selectedEvent();
  if (!schedule) return;
  state.selectedSessionId = schedule.session_id;
  enterMode(schedule.tag === "×" ? "new-blocked" : "duplicate-schedule", { scheduleValues: deepClone(schedule), sourceEventId: schedule.id });
});
elements.reschedule_button.addEventListener("click", () => {
  const schedule = selectedEvent();
  if (!schedule) return;
  enterMode("reschedule", { scheduleValues: deepClone(schedule), sourceEventId: schedule.id });
});
elements.delete_schedule_button.addEventListener("click", () => {
  const schedule = selectedEvent();
  if (!schedule) return;
  const siblings = selectedSessionEvents();
  if (schedule.tag !== "×" && siblings.length <= 1) {
    setStatus("最後の1日程は単独削除できません。上の「セッション削除」を使用してください。", "warning");
    return;
  }
  if (!window.confirm(`${eventDate(schedule)}の「${eventDisplayTitle(schedule)}」を削除しますか？`)) return;
  recordMutation("日程の削除", (data) => { data.events = data.events.filter((item) => item.id !== schedule.id); });
  state.selectedEventId = null;
  if (schedule.tag === "×") state.selectedSessionId = null;
  renderAll({ forceForms: true });
});

elements.month_note_form.addEventListener("submit", (event) => {
  event.preventDefault();
  const key = monthKey();
  const note = elements.month_note.value.trim();
  recordMutation("月メモの変更", (data) => {
    if (note) data.monthly_notes[key] = note;
    else delete data.monthly_notes[key];
  });
  clearPending("month");
  renderAll({ forceForms: true });
});

elements.settings_form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.calendar_name.value.trim();
  if (!name) { setStatus("ページ名を入力してください。", "error"); return; }
  recordMutation("ページ設定の変更", (data) => {
    data.calendar_name = name;
    data.description = elements.calendar_description.value.trim();
  });
  clearPending("settings");
  renderAll({ forceForms: true });
});

elements.previous_month_button.addEventListener("click", () => changeMonth(-1));
elements.next_month_button.addEventListener("click", () => changeMonth(1));
elements.today_button.addEventListener("click", () => {
  const today = new Date();
  state.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  clearPending("month");
  renderAll();
});
elements.month_input.addEventListener("change", () => setMonth(elements.month_input.value));
elements.undo_button.addEventListener("click", undo);
elements.redo_button.addEventListener("click", redo);
elements.download_button.addEventListener("click", downloadJson);
elements.reload_button.addEventListener("click", () => loadCalendar());
elements.save_button.addEventListener("click", saveCalendar);
elements.conflict_download_button.addEventListener("click", downloadJson);
elements.conflict_reload_button.addEventListener("click", () => loadCalendar());

elements.month_note.addEventListener("input", () => markPending("month"));
elements.session_form.addEventListener("input", () => markPending("session"));
elements.schedule_form.addEventListener("input", () => markPending("schedule"));
elements.create_form.addEventListener("input", () => markPending("create"));
elements.settings_form.addEventListener("input", () => markPending("settings"));

for (const scope of ["create", "edit"]) {
  const fields = scheduleFields(scope);
  fields.allDay.addEventListener("change", () => {
    fields.start.disabled = fields.allDay.checked;
    fields.end.disabled = fields.allDay.checked;
  });
  for (const input of [fields.start, fields.end]) {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => {
      if (!input.value.trim()) return;
      const normalized = input === fields.start ? normalizeStartTimeText(input.value) : normalizeEndTimeText(input.value);
      if (normalized) input.value = normalized;
    });
  }
}

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "s") { event.preventDefault(); saveCalendar(); }
  else if (event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
  else if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) { event.preventDefault(); redo(); }
  else if (event.key.toLowerCase() === "n") { event.preventDefault(); elements.new_session_button.click(); }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty && !state.pendingForms.size) return;
  event.preventDefault();
  event.returnValue = "";
});

loadCalendar({ initial: true });
