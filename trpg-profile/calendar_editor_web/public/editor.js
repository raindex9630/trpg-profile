import {
  BLOCKED_PERIODS,
  VALID_TAGS,
  automaticallyEndsNextDay,
  coalesceSameTitleSessions,
  composeSessionTitle,
  createId,
  createSessionEventsFromOccurrences,
  deepClone,
  eventDisplayTitle,
  formatEventTime,
  isValidDateText,
  normalizeBlockedPeriod,
  normalizeData,
  normalizeEndTimeText,
  normalizeStartTimeText,
  replaceSessionOccurrences,
  splitSessionTitle,
  validateCalendarData,
} from "./calendar-core.js";

const PUBLIC_CALENDAR_URL = "https://trpg-profile.pages.dev/calendar.html";
const HISTORY_LIMIT = 100;
const TAG_CLASSES = {
  GM: "tag-gm",
  PL: "tag-pl",
  "仮押さえ": "tag-hold",
  "×": "tag-blocked",
};

const state = {
  data: null,
  baseSha: "",
  savedSignature: "",
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
  panel: null,
  undo: [],
  redo: [],
  loading: false,
  wheelTotal: 0,
  wheelLockedUntil: 0,
  pointerStart: null,
};

const elementIds = [
  "workspace", "status", "edit-panel", "panel-title", "panel-close-button",
  "session-editor-form", "scenario-name", "session-round", "selection-guide",
  "add-dates-mode-button", "bulk-time-panel", "bulk-start-time", "bulk-end-time",
  "apply-bulk-time-button", "bulk-period-panel", "bulk-period", "apply-bulk-period-button",
  "occurrence-list", "empty-occurrences", "occurrence-count", "delete-session-button",
  "panel-cancel-button", "panel-save-button", "month-prev", "month-next", "month-label", "month-today",
  "month-jump", "copy-public-url", "new-session-button", "calendar-updated",
  "dirty-indicator", "undo-button", "redo-button", "download-button", "reload-button",
  "page-settings-button", "save-button", "conflict-panel", "conflict-download-button",
  "conflict-reload-button", "calendar-grid", "monthly-note-title", "monthly-note-text",
  "edit-month-note-button", "month-jump-dialog", "month-jump-input", "month-note-dialog",
  "month-note-form", "month-note-label", "month-note", "month-note-close-button",
  "month-note-cancel-button", "page-settings-dialog", "settings-form", "calendar-name",
  "calendar-description", "page-settings-close-button", "page-settings-cancel-button",
];
const elements = Object.fromEntries(elementIds.map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

function signature(value) {
  return JSON.stringify(value);
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

function eventDate(event) {
  return String(event?.dates?.[0] || "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "不明なエラーです。");
}

let statusDismissTimer;
function setStatus(message, kind = "info") {
  window.clearTimeout(statusDismissTimer);
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
  if (kind === "success") {
    statusDismissTimer = window.setTimeout(() => { elements.status.textContent = ""; }, 5000);
  }
}

function selectedTag() {
  return document.querySelector('input[name="session-tag"]:checked')?.value || state.panel?.tag || "PL";
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

function updateStateIndicators() {
  const dirty = Boolean(state.data) && signature(state.data) !== state.savedSignature;
  elements.dirty_indicator.classList.toggle("is-dirty", dirty);
  elements.dirty_indicator.textContent = state.loading ? "処理中" : dirty ? "GitHubへ未保存" : state.data ? "保存済み" : "未読込";
  elements.undo_button.disabled = state.loading || !state.undo.length;
  elements.redo_button.disabled = state.loading || !state.redo.length;
  elements.download_button.disabled = !state.data;
  elements.reload_button.disabled = state.loading;
  elements.save_button.disabled = state.loading || !state.data || !state.baseSha || !dirty;
  elements.panel_save_button.disabled = state.loading;
  elements.delete_session_button.disabled = state.loading;
}

function panelComparable(panel = state.panel) {
  if (!panel) return null;
  return {
    tag: panel.tag,
    scenarioName: panel.scenarioName,
    round: panel.round,
    occurrences: panel.occurrences.map((item) => ({
      eventId: item.eventId || "",
      date: item.date,
      all_day: item.all_day,
      start_time: item.start_time,
      end_time: item.end_time,
      is_backup_date: item.is_backup_date,
      schedule_note: item.schedule_note,
      blocked_period: item.blocked_period,
    })),
  };
}

function panelIsDirty() {
  return Boolean(state.panel) && signature(panelComparable()) !== state.panel.baseline;
}

function setPanelBaseline() {
  if (state.panel) state.panel.baseline = signature(panelComparable());
}

function defaultOccurrence(date = "") {
  return {
    key: createId(),
    eventId: "",
    date,
    all_day: false,
    start_time: "21:00",
    end_time: "24:00",
    end_next_day: true,
    is_backup_date: false,
    schedule_note: "",
    blocked_period: "all_day",
  };
}

function occurrenceFromEvent(event) {
  return {
    key: String(event.id || createId()),
    eventId: String(event.id || ""),
    date: eventDate(event),
    all_day: Boolean(event.all_day),
    start_time: String(event.start_time || ""),
    end_time: String(event.end_time || ""),
    end_next_day: Boolean(event.end_next_day),
    is_backup_date: Boolean(event.is_backup_date),
    schedule_note: String(event.schedule_note || ""),
    blocked_period: normalizeBlockedPeriod(event),
  };
}

let panelTransitionId = 0;

function showPanel() {
  panelTransitionId += 1;
  elements.workspace.classList.remove("is-panel-closing");
  elements.workspace.classList.add("is-panel-open");
  elements.edit_panel.inert = false;
  elements.edit_panel.hidden = false;
}

function hidePanel() {
  const transitionId = ++panelTransitionId;
  const panel = elements.edit_panel;
  const currentStyle = window.getComputedStyle(panel);
  panel.style.setProperty("--panel-close-transform", currentStyle.transform);
  panel.style.setProperty("--panel-close-opacity", currentStyle.opacity);
  if (panel.contains(document.activeElement)) elements.new_session_button.focus();
  panel.inert = true;
  elements.workspace.classList.remove("is-panel-open");
  elements.workspace.classList.add("is-panel-closing");
  const finish = () => {
    // A completed or cancelled old animation must not hide a newly opened pane.
    if (transitionId !== panelTransitionId || state.panel) return;
    panel.hidden = true;
    panel.inert = false;
    elements.workspace.classList.remove("is-panel-closing");
  };
  const animations = panel.getAnimations();
  if (animations.length) Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
  else finish(); // Includes prefers-reduced-motion and an already hidden pane.
}

function closePanel({ force = false } = {}) {
  if (!state.panel) return true;
  if (!force && panelIsDirty() && !window.confirm("入力中の変更を破棄して編集パネルを閉じますか？")) return false;
  state.panel = null;
  hidePanel();
  renderCalendar();
  return true;
}

function openCreatePanel(initialDate = "") {
  if (state.panel && !closePanel()) return;
  state.panel = {
    mode: "create",
    sessionId: "",
    tag: "PL",
    scenarioName: "",
    round: "",
    addingDates: true,
    occurrences: initialDate ? [defaultOccurrence(initialDate)] : [],
    baseline: "",
  };
  setPanelBaseline();
  renderPanel();
}

function openEditPanel(eventId) {
  const selected = state.data?.events.find((event) => String(event.id) === String(eventId));
  if (!selected) return;
  if (state.panel && !closePanel()) return;
  const sessionId = String(selected.session_id || selected.id);
  const sessionEvents = state.data.events
    .filter((event) => String(event.session_id || event.id) === sessionId)
    .sort((left, right) => eventDate(left).localeCompare(eventDate(right)));
  const titleParts = selected.tag === "×" ? { scenarioName: "", round: "" } : splitSessionTitle(selected.title);
  state.panel = {
    mode: "edit",
    sessionId,
    tag: selected.tag,
    scenarioName: titleParts.scenarioName,
    round: titleParts.round,
    addingDates: false,
    occurrences: sessionEvents.map(occurrenceFromEvent),
    baseline: "",
  };
  setPanelBaseline();
  renderPanel();
}

function renderPanel() {
  const panel = state.panel;
  if (!panel) return closePanel({ force: true });
  showPanel();
  elements.panel_title.textContent = panel.mode === "create" ? "セッション追加" : "セッション編集";
  elements.panel_save_button.textContent = panel.mode === "create" ? "登録" : "変更を保存";
  elements.delete_session_button.hidden = panel.mode !== "edit";
  elements.add_dates_mode_button.hidden = panel.mode !== "edit";
  elements.add_dates_mode_button.textContent = panel.addingDates ? "日程追加を終了" : "＋ このセッションに日程を追加";
  elements.scenario_name.value = panel.scenarioName;
  elements.session_round.value = panel.round;
  const tagInput = document.querySelector(`input[name="session-tag"][value="${panel.tag}"]`);
  if (tagInput) tagInput.checked = true;
  const isBlocked = panel.tag === "×";
  elements.scenario_name.disabled = isBlocked;
  elements.session_round.disabled = isBlocked;
  elements.bulk_time_panel.hidden = panel.tag === "仮押さえ" || isBlocked;
  elements.bulk_period_panel.hidden = panel.tag !== "仮押さえ" && !isBlocked;
  elements.selection_guide.classList.toggle("is-passive", panel.mode === "edit" && !panel.addingDates);
  elements.selection_guide.textContent = panel.mode === "edit" && !panel.addingDates
    ? "日程を追加する場合は、下のボタンを押してください。"
    : "カレンダー上の日付をクリックして追加（複数選択可）";
  renderOccurrences();
  renderCalendar();
  updateStateIndicators();
  if (panel.mode === "create") elements.scenario_name.focus();
}

function makeLabel(text, control) {
  const label = document.createElement("label");
  label.className = "check-label";
  label.append(control, document.createTextNode(text));
  return label;
}

function occurrenceControl(type, value, key, field, ariaLabel) {
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.dataset.occurrenceKey = key;
  input.dataset.field = field;
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

function renderOccurrences() {
  const panel = state.panel;
  if (!panel) return;
  elements.occurrence_list.replaceChildren();
  elements.occurrence_count.textContent = `${panel.occurrences.length}件`;
  elements.empty_occurrences.hidden = panel.occurrences.length > 0;
  const periodMode = panel.tag === "仮押さえ" || panel.tag === "×";

  panel.occurrences.forEach((occurrence, index) => {
    const card = document.createElement("article");
    card.className = `occurrence-card${occurrence.eventId ? "" : " is-new"}`;
    card.dataset.occurrenceKey = occurrence.key;

    const head = document.createElement("div");
    head.className = "occurrence-head";
    const dateInput = occurrenceControl("date", occurrence.date, occurrence.key, "date", `${index + 1}件目の日付`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-occurrence";
    remove.dataset.removeOccurrence = occurrence.key;
    remove.setAttribute("aria-label", `${occurrence.date || index + 1}の日程を削除`);
    remove.textContent = "×";
    head.append(dateInput, remove);

    const fields = document.createElement("div");
    fields.className = "occurrence-fields";
    if (periodMode) {
      const period = document.createElement("select");
      period.dataset.occurrenceKey = occurrence.key;
      period.dataset.field = "blocked_period";
      period.setAttribute("aria-label", `${occurrence.date}の時間帯`);
      for (const [value, item] of Object.entries(BLOCKED_PERIODS)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = panel.tag === "仮押さえ" ? item.holdLabel : item.label;
        period.append(option);
      }
      period.value = occurrence.blocked_period;
      fields.append(period);
    } else {
      const allDay = document.createElement("input");
      allDay.type = "checkbox";
      allDay.checked = occurrence.all_day;
      allDay.dataset.occurrenceKey = occurrence.key;
      allDay.dataset.field = "all_day";
      const options = document.createElement("div");
      options.className = "occurrence-options";
      options.append(makeLabel("終日", allDay));

      if (!occurrence.all_day) {
        const timeRow = document.createElement("div");
        timeRow.className = "occurrence-time-row";
        const start = occurrenceControl("text", occurrence.start_time || "21:00", occurrence.key, "start_time", `${occurrence.date}の開始時刻`);
        start.inputMode = "numeric";
        const end = occurrenceControl("text", occurrence.end_time || "24:00", occurrence.key, "end_time", `${occurrence.date}の終了時刻`);
        end.inputMode = "numeric";
        timeRow.append(start, document.createTextNode("～"), end);
        fields.append(timeRow);
      }

      const backup = document.createElement("input");
      backup.type = "checkbox";
      backup.checked = occurrence.is_backup_date;
      backup.dataset.occurrenceKey = occurrence.key;
      backup.dataset.field = "is_backup_date";
      options.append(makeLabel("予備日", backup));
      fields.append(options);

      const note = occurrenceControl("text", occurrence.schedule_note, occurrence.key, "schedule_note", `${occurrence.date}の注記`);
      note.className = "schedule-note-input";
      note.placeholder = "この日程だけの注記（任意）";
      note.maxLength = 160;
      fields.append(note);
    }
    card.append(head, fields);
    elements.occurrence_list.append(card);
  });
}

function eventsOnDate(dateKey) {
  return state.data.events.filter((event) => event.dates.includes(dateKey)).sort(compareEvents);
}

function draftHasDate(dateKey) {
  return Boolean(state.panel?.occurrences.some((occurrence) => occurrence.date === dateKey));
}

function renderCalendar() {
  if (!state.data) return;
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const currentKey = monthKey();
  elements.month_label.textContent = `${year}年${month + 1}月`;
  elements.month_jump_input.value = currentKey;
  elements.calendar_updated.textContent = state.data.updated_at ? `最終更新: ${state.data.updated_at}` : "";
  elements.monthly_note_title.textContent = `${year}年${month + 1}月のメモ`;
  elements.monthly_note_text.textContent = state.data.monthly_notes[currentKey] || "メモはありません。";
  elements.calendar_grid.replaceChildren();

  const dayCount = new Date(year, month + 1, 0, 12).getDate();
  const leading = (new Date(year, month, 1, 12).getDay() + 6) % 7;
  const cellCount = Math.ceil((leading + dayCount) / 7) * 7;
  const todayKey = localDateKey(new Date());
  for (let index = 0; index < cellCount; index += 1) {
    const day = index - leading + 1;
    if (day < 1 || day > dayCount) {
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
    cell.setAttribute("aria-label", `${year}年${month + 1}月${day}日、${dayEvents.length}件の予定`);
    if (date.getDay() === 6) cell.classList.add("is-saturday");
    if (date.getDay() === 0 || JapaneseHolidays.has(dateKey)) cell.classList.add("is-holiday");
    if (dateKey === todayKey) cell.classList.add("is-today");
    if (draftHasDate(dateKey)) cell.classList.add("is-draft-selected");

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(day);
    const eventWrap = document.createElement("div");
    eventWrap.className = "day-events";
    if (dayEvents.length >= 3) {
      cell.classList.add("is-crowded");
      cell.style.setProperty("--event-count", dayEvents.length);
    }
    dayEvents.forEach((calendarEvent) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `event-card ${TAG_CLASSES[calendarEvent.tag] || ""}`;
      button.dataset.eventId = calendarEvent.id;
      button.classList.toggle("is-session-highlighted", Boolean(state.panel) && String(calendarEvent.session_id || calendarEvent.id) === state.panel.sessionId);
      button.setAttribute("aria-label", [calendarEvent.tag === "×" ? "予定アリ" : calendarEvent.tag, eventDisplayTitle(calendarEvent), formatEventTime(calendarEvent)].filter(Boolean).join(" "));
      const title = document.createElement("span");
      title.className = "event-title";
      title.textContent = eventDisplayTitle(calendarEvent);
      button.append(title);
      const time = formatEventTime(calendarEvent);
      if (time) {
        const timeText = document.createElement("span");
        timeText.className = "event-time";
        timeText.textContent = time;
        button.append(timeText);
      }
      eventWrap.append(button);
    });
    cell.append(number, eventWrap);
    elements.calendar_grid.append(cell);
  }
}

function renderAll() {
  renderCalendar();
  updateStateIndicators();
}

function changeMonth(offset) {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + offset, 1, 12);
  history.replaceState(null, "", `#${monthKey()}`);
  renderCalendar();
}

function setMonth(value) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(value))) return;
  const [year, month] = value.split("-").map(Number);
  state.currentMonth = new Date(year, month - 1, 1, 12);
  history.replaceState(null, "", `#${monthKey()}`);
  renderCalendar();
}

function toggleDraftDate(dateKey) {
  const panel = state.panel;
  if (!panel || (panel.mode === "edit" && !panel.addingDates)) return;
  const index = panel.occurrences.findIndex((occurrence) => occurrence.date === dateKey);
  if (index >= 0) {
    removeDraftOccurrence(panel.occurrences[index].key);
    return;
  } else {
    const next = defaultOccurrence(dateKey);
    if (panel.tag === "仮押さえ" || panel.tag === "×") {
      next.blocked_period = "all_day";
      next.all_day = true;
    }
    panel.occurrences.push(next);
    panel.occurrences.sort((left, right) => left.date.localeCompare(right.date));
  }
  renderOccurrences();
  renderCalendar();
}

function removeDraftOccurrence(key) {
  const panel = state.panel;
  const index = panel?.occurrences.findIndex((item) => item.key === key) ?? -1;
  if (index < 0) return;
  if (panel.occurrences.length === 1) {
    if (panel.mode === "edit") {
      setStatus("最後の日程は単独削除できません。セッション削除を使用してください。", "warning");
      return;
    }
    // Selecting dates alone is not content to discard. Ask before losing edited fields,
    // and keep the last selection intact if the user cancels the confirmation.
    const untouched = panelComparable({
      ...panel,
      tag: "PL",
      scenarioName: "",
      round: "",
      occurrences: [defaultOccurrence(panel.occurrences[0].date)],
    });
    const hasContentChanges = signature(panelComparable()) !== signature(untouched);
    if (closePanel({ force: !hasContentChanges })) elements.new_session_button.focus();
    return;
  }
  panel.occurrences.splice(index, 1);
  renderOccurrences();
  renderCalendar();
}

function updatePanelIdentity() {
  if (!state.panel) return;
  state.panel.scenarioName = elements.scenario_name.value;
  state.panel.round = elements.session_round.value;
  state.panel.tag = selectedTag();
}

function adaptOccurrencesForTag() {
  const tag = state.panel.tag;
  state.panel.occurrences.forEach((occurrence) => {
    if (tag === "仮押さえ" || tag === "×") {
      occurrence.blocked_period ||= "all_day";
      occurrence.all_day = occurrence.blocked_period === "all_day";
      occurrence.start_time = occurrence.all_day ? "" : BLOCKED_PERIODS[occurrence.blocked_period].startTime;
      occurrence.end_time = "";
      occurrence.end_next_day = false;
      if (tag === "×") {
        occurrence.is_backup_date = false;
        occurrence.schedule_note = "";
      }
    } else if (!occurrence.all_day) {
      occurrence.start_time = normalizeStartTimeText(occurrence.start_time) || "21:00";
      occurrence.end_time = normalizeEndTimeText(occurrence.end_time) || "24:00";
      occurrence.end_next_day = automaticallyEndsNextDay(occurrence.start_time, occurrence.end_time, false);
    }
  });
}

function normalizedPanelOccurrences() {
  const panel = state.panel;
  if (!panel.occurrences.length) throw new Error("日付を1件以上選択してください。");
  const dates = new Set();
  return panel.occurrences.map((item) => {
    if (!isValidDateText(item.date)) throw new Error("日付を正しく入力してください。");
    if (dates.has(item.date)) throw new Error(`${item.date} が重複しています。`);
    dates.add(item.date);
    if (panel.tag === "仮押さえ" || panel.tag === "×") {
      const period = BLOCKED_PERIODS[item.blocked_period] ? item.blocked_period : "all_day";
      return {
        ...item,
        all_day: period === "all_day",
        start_time: period === "all_day" ? "" : BLOCKED_PERIODS[period].startTime,
        end_time: "",
        end_next_day: false,
        is_backup_date: panel.tag === "×" ? false : Boolean(item.is_backup_date),
        schedule_note: panel.tag === "×" ? "" : String(item.schedule_note || "").trim(),
        blocked_period: period,
      };
    }
    if (item.all_day) {
      return { ...item, all_day: true, start_time: "", end_time: "", end_next_day: false };
    }
    const start = normalizeStartTimeText(item.start_time);
    if (!start) throw new Error(`${item.date} の開始時刻は00:00～23:59で入力してください。`);
    const end = item.end_time.trim() ? normalizeEndTimeText(item.end_time) : "";
    if (item.end_time.trim() && !end) throw new Error(`${item.date} の終了時刻は00:00～47:59で入力してください。`);
    return {
      ...item,
      all_day: false,
      start_time: start,
      end_time: end,
      end_next_day: automaticallyEndsNextDay(start, end, false),
      is_backup_date: Boolean(item.is_backup_date),
      schedule_note: String(item.schedule_note || "").trim(),
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

async function readApiResponse(response) {
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`サーバー応答を読み取れませんでした（HTTP ${response.status}）。`); }
  if (!response.ok) {
    const error = new Error(body?.error?.message || `APIエラー（HTTP ${response.status}）`);
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

async function persistData(nextData, label, { closePanelAfter = false, addHistory = true } = {}) {
  if (state.loading) return false;
  const errors = validateCalendarData(nextData);
  if (errors.length) {
    setStatus(`保存内容を確認してください：${errors[0]}`, "error");
    return false;
  }
  const previous = deepClone(state.data);
  state.loading = true;
  updateStateIndicators();
  setStatus(`${label}をGitHubへ保存しています…`, "info");
  try {
    const response = await fetch("/api/calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseSha: state.baseSha, data: nextData }),
    });
    const payload = await readApiResponse(response);
    state.data = normalizeData(payload.data);
    state.baseSha = payload.sha;
    state.savedSignature = signature(state.data);
    if (addHistory && signature(previous) !== signature(state.data)) {
      state.undo.push({ label, data: previous });
      if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
      state.redo = [];
    }
    elements.conflict_panel.hidden = true;
    if (closePanelAfter) closePanel({ force: true });
    renderAll();
    setStatus(`✓ ${label}をGitHubへ保存しました。公開反映はCloudflare Pagesのデプロイ後です。`, "success");
    return true;
  } catch (error) {
    if (error.status === 409 || error.code === "SHA_CONFLICT" || error.code === "GITHUB_UPDATE_CONFLICT") {
      elements.conflict_panel.hidden = false;
      setStatus("保存の競合を検出しました。入力内容は保持しています。", "warning");
    } else {
      setStatus(`保存に失敗しました。入力内容は保持しています：${errorMessage(error)}`, "error");
    }
    return false;
  } finally {
    state.loading = false;
    updateStateIndicators();
  }
}

async function savePanel() {
  const panel = state.panel;
  if (!panel) return;
  updatePanelIdentity();
  if (!VALID_TAGS.includes(panel.tag)) return setStatus("区分を選択してください。", "error");
  const scenarioName = panel.scenarioName.trim();
  if (panel.tag !== "×" && !scenarioName) return setStatus("シナリオ名を入力してください。", "error");
  let occurrences;
  try { occurrences = normalizedPanelOccurrences(); }
  catch (error) { return setStatus(errorMessage(error), "error"); }

  const nextData = deepClone(state.data);
  const title = panel.tag === "×" ? "×" : composeSessionTitle(scenarioName, panel.round.trim());
  if (panel.mode === "create") {
    const sessionId = createId();
    nextData.events.push(...createSessionEventsFromOccurrences(sessionId, title, panel.tag, occurrences));
  } else {
    replaceSessionOccurrences(nextData.events, panel.sessionId, title, panel.tag, occurrences);
  }
  if (panel.tag !== "×") coalesceSameTitleSessions(nextData.events);
  await persistData(nextData, panel.mode === "create" ? "セッションの登録" : "セッションの変更", { closePanelAfter: true });
}

async function deleteSession() {
  const panel = state.panel;
  if (!panel || panel.mode !== "edit") return;
  const label = panel.tag === "×" ? "この予定" : `「${composeSessionTitle(panel.scenarioName, panel.round)}」`;
  if (!window.confirm(`${label}と全日程を削除しますか？`)) return;
  const nextData = deepClone(state.data);
  nextData.events = nextData.events.filter((event) => String(event.session_id || event.id) !== panel.sessionId);
  await persistData(nextData, "セッションの削除", { closePanelAfter: true });
}

async function saveCurrentData() {
  if (!state.data || signature(state.data) === state.savedSignature) return;
  await persistData(deepClone(state.data), "編集内容", { addHistory: false });
}

async function loadCalendar({ initial = false } = {}) {
  const localDirty = Boolean(state.data) && signature(state.data) !== state.savedSignature;
  if (!initial && (localDirty || panelIsDirty()) && !window.confirm("未保存の変更を破棄してGitHubの最新版を読み込みますか？")) return;
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
    state.panel = null;
    hidePanel();
    elements.conflict_panel.hidden = true;
    elements.workspace.hidden = false;
    document.title = `${state.data.calendar_name}｜編集`;
    renderAll();
    setStatus(initial ? "" : "GitHubの最新版を読み込みました。カレンダーから追加・編集できます。", "success");
  } catch (error) {
    setStatus(`読込に失敗しました：${errorMessage(error)}`, "error");
  } finally {
    state.loading = false;
    updateStateIndicators();
  }
}

function undo() {
  const entry = state.undo.pop();
  if (!entry || state.loading) return;
  state.redo.push({ label: entry.label, data: deepClone(state.data) });
  state.data = entry.data;
  closePanel({ force: true });
  renderAll();
  setStatus(`「${entry.label}」を元に戻しました。GitHubへ保存すると確定します。`, "success");
}

function redo() {
  const entry = state.redo.pop();
  if (!entry || state.loading) return;
  state.undo.push({ label: entry.label, data: deepClone(state.data) });
  state.data = entry.data;
  closePanel({ force: true });
  renderAll();
  setStatus(`「${entry.label}」をやり直しました。GitHubへ保存すると確定します。`, "success");
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

elements.new_session_button.addEventListener("click", () => openCreatePanel());
elements.panel_close_button.addEventListener("click", () => closePanel());
elements.panel_cancel_button.addEventListener("click", () => closePanel());
elements.session_editor_form.addEventListener("submit", (event) => { event.preventDefault(); savePanel(); });
elements.delete_session_button.addEventListener("click", deleteSession);
elements.add_dates_mode_button.addEventListener("click", () => {
  state.panel.addingDates = !state.panel.addingDates;
  renderPanel();
});

elements.session_editor_form.addEventListener("input", (event) => {
  if (!state.panel) return;
  if (event.target === elements.scenario_name) state.panel.scenarioName = event.target.value;
  if (event.target === elements.session_round) state.panel.round = event.target.value;
});
document.querySelectorAll('input[name="session-tag"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    state.panel.tag = radio.value;
    adaptOccurrencesForTag();
    renderPanel();
  });
});

elements.occurrence_list.addEventListener("input", (event) => {
  const key = event.target.dataset.occurrenceKey;
  const field = event.target.dataset.field;
  const occurrence = state.panel?.occurrences.find((item) => item.key === key);
  if (!occurrence || !field) return;
  occurrence[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
});
elements.occurrence_list.addEventListener("change", (event) => {
  const key = event.target.dataset.occurrenceKey;
  const field = event.target.dataset.field;
  const occurrence = state.panel?.occurrences.find((item) => item.key === key);
  if (!occurrence || !field) return;
  occurrence[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  if (field === "all_day") {
    if (!occurrence.all_day) {
      occurrence.start_time ||= "21:00";
      occurrence.end_time ||= "24:00";
    }
    renderOccurrences();
  } else if (field === "blocked_period") {
    occurrence.all_day = occurrence.blocked_period === "all_day";
  } else if (field === "date") {
    state.panel.occurrences.sort((left, right) => left.date.localeCompare(right.date));
    renderOccurrences();
    renderCalendar();
  }
});
elements.occurrence_list.addEventListener("focusout", (event) => {
  const field = event.target.dataset.field;
  if (field !== "start_time" && field !== "end_time") return;
  const occurrence = state.panel?.occurrences.find((item) => item.key === event.target.dataset.occurrenceKey);
  if (!occurrence || !event.target.value.trim()) return;
  const normalized = field === "start_time" ? normalizeStartTimeText(event.target.value) : normalizeEndTimeText(event.target.value);
  if (normalized) {
    occurrence[field] = normalized;
    event.target.value = normalized;
  }
});
elements.occurrence_list.addEventListener("click", (event) => {
  const key = event.target.closest("[data-remove-occurrence]")?.dataset.removeOccurrence;
  if (!key || !state.panel) return;
  removeDraftOccurrence(key);
});

elements.apply_bulk_time_button.addEventListener("click", () => {
  if (!state.panel) return;
  const start = normalizeStartTimeText(elements.bulk_start_time.value);
  const end = normalizeEndTimeText(elements.bulk_end_time.value);
  if (!start || !end) return setStatus("一括時刻は開始00:00～23:59、終了00:00～47:59で入力してください。", "error");
  elements.bulk_start_time.value = start;
  elements.bulk_end_time.value = end;
  state.panel.occurrences.forEach((occurrence) => {
    occurrence.all_day = false;
    occurrence.start_time = start;
    occurrence.end_time = end;
    occurrence.end_next_day = automaticallyEndsNextDay(start, end, false);
  });
  renderOccurrences();
  setStatus("全日程へ時刻を適用しました。", "success");
});
elements.apply_bulk_period_button.addEventListener("click", () => {
  if (!state.panel) return;
  const period = elements.bulk_period.value;
  state.panel.occurrences.forEach((occurrence) => {
    occurrence.blocked_period = period;
    occurrence.all_day = period === "all_day";
  });
  renderOccurrences();
  setStatus("全日程へ時間帯を適用しました。", "success");
});

elements.calendar_grid.addEventListener("click", (event) => {
  const eventButton = event.target.closest("[data-event-id]");
  const dayCell = event.target.closest("[data-date]");
  if (state.panel) {
    if (eventButton) {
      if (state.panel.mode === "create" || state.panel.addingDates) return;
      return;
    }
    if (dayCell) toggleDraftDate(dayCell.dataset.date);
    return;
  }
  if (eventButton) openEditPanel(eventButton.dataset.eventId);
  else if (dayCell) openCreatePanel(dayCell.dataset.date);
});
elements.calendar_grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const day = event.target.closest("[data-date]");
  if (!day) return;
  event.preventDefault();
  if (state.panel) toggleDraftDate(day.dataset.date);
  else openCreatePanel(day.dataset.date);
});

elements.month_prev.addEventListener("click", () => changeMonth(-1));
elements.month_next.addEventListener("click", () => changeMonth(1));
elements.month_today.addEventListener("click", () => setMonth(localDateKey(new Date()).slice(0, 7)));
elements.month_jump.addEventListener("click", () => elements.month_jump_dialog.showModal());
elements.month_jump_input.addEventListener("change", () => {
  setMonth(elements.month_jump_input.value);
  elements.month_jump_dialog.close();
});
elements.copy_public_url.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(PUBLIC_CALENDAR_URL);
    elements.copy_public_url.classList.add("is-copied");
    elements.copy_public_url.textContent = "コピーしました";
    setTimeout(() => {
      elements.copy_public_url.classList.remove("is-copied");
      elements.copy_public_url.textContent = "共有URLをコピー";
    }, 1800);
  } catch {
    setStatus(`共有URL：${PUBLIC_CALENDAR_URL}`, "warning");
  }
});

elements.edit_month_note_button.addEventListener("click", () => {
  elements.month_note_label.textContent = `${elements.month_label.textContent}のメモ`;
  elements.month_note.value = state.data.monthly_notes[monthKey()] || "";
  elements.month_note_dialog.showModal();
  elements.month_note.focus();
});
elements.month_note_close_button.addEventListener("click", () => elements.month_note_dialog.close());
elements.month_note_cancel_button.addEventListener("click", () => elements.month_note_dialog.close());
elements.month_note_form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextData = deepClone(state.data);
  const note = elements.month_note.value.trim();
  if (note) nextData.monthly_notes[monthKey()] = note;
  else delete nextData.monthly_notes[monthKey()];
  if (await persistData(nextData, "月メモの変更")) elements.month_note_dialog.close();
});

elements.page_settings_button.addEventListener("click", () => {
  elements.calendar_name.value = state.data.calendar_name;
  elements.calendar_description.value = state.data.description;
  elements.page_settings_dialog.showModal();
  elements.calendar_name.focus();
});
elements.page_settings_close_button.addEventListener("click", () => elements.page_settings_dialog.close());
elements.page_settings_cancel_button.addEventListener("click", () => elements.page_settings_dialog.close());
elements.settings_form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.calendar_name.value.trim();
  if (!name) return setStatus("ページ名を入力してください。", "error");
  const nextData = deepClone(state.data);
  nextData.calendar_name = name;
  nextData.description = elements.calendar_description.value.trim();
  if (await persistData(nextData, "ページ設定の変更")) {
    document.title = `${name}｜編集`;
    elements.page_settings_dialog.close();
  }
});

elements.undo_button.addEventListener("click", undo);
elements.redo_button.addEventListener("click", redo);
elements.download_button.addEventListener("click", downloadJson);
elements.reload_button.addEventListener("click", () => loadCalendar());
elements.save_button.addEventListener("click", saveCurrentData);
elements.conflict_download_button.addEventListener("click", downloadJson);
elements.conflict_reload_button.addEventListener("click", () => loadCalendar());

document.addEventListener("click", (event) => {
  const menu = document.querySelector(".owner-menu");
  if (menu?.open && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener("keydown", (event) => {
  const inputActive = event.target.matches?.("input, textarea, select, button, summary");
  if (event.key === "Escape" && state.panel) {
    event.preventDefault();
    closePanel();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (state.panel) savePanel(); else saveCurrentData();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openCreatePanel();
    return;
  }
  if (inputActive || state.panel || document.querySelector("dialog[open]")) return;
  if (event.key === "ArrowLeft") changeMonth(-1);
  if (event.key === "ArrowRight") changeMonth(1);
});

elements.calendar_grid.addEventListener("wheel", (event) => {
  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  event.preventDefault();
  if (Date.now() < state.wheelLockedUntil) return;
  state.wheelTotal += event.deltaY;
  if (Math.abs(state.wheelTotal) < 80) return;
  changeMonth(state.wheelTotal > 0 ? 1 : -1);
  state.wheelTotal = 0;
  state.wheelLockedUntil = Date.now() + 500;
}, { passive: false });
elements.calendar_grid.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return;
  state.pointerStart = { x: event.clientX, y: event.clientY };
});
elements.calendar_grid.addEventListener("pointerup", (event) => {
  if (!state.pointerStart || state.panel) return;
  const dx = event.clientX - state.pointerStart.x;
  const dy = event.clientY - state.pointerStart.y;
  state.pointerStart = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) changeMonth(dx < 0 ? 1 : -1);
});

window.addEventListener("beforeunload", (event) => {
  const localDirty = Boolean(state.data) && signature(state.data) !== state.savedSignature;
  if (!localDirty && !panelIsDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderCalendar();
});

if (/^#\d{4}-(?:0[1-9]|1[0-2])$/.test(location.hash)) setMonth(location.hash.slice(1));
loadCalendar({ initial: true });
