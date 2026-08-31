const JapaneseHolidays = (() => {
    "use strict";

    const cache = new Map();

    function dateKey(year, month, day) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    function parseDateKey(value) {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day, 12);
    }

    function addDays(value, amount) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount, 12);
    }

    function nthMonday(year, month, nth) {
        const first = new Date(year, month - 1, 1, 12);
        const offset = (8 - first.getDay()) % 7;
        return 1 + offset + ((nth - 1) * 7);
    }

    function addHoliday(target, year, month, day) {
        target.add(dateKey(year, month, day));
    }

    function holidaysForYear(year) {
        if (cache.has(year)) return cache.get(year);

        const nationalHolidays = new Set();
        if (year < 2000 || year > 2099) {
            cache.set(year, nationalHolidays);
            return nationalHolidays;
        }

        addHoliday(nationalHolidays, year, 1, 1);
        addHoliday(nationalHolidays, year, 1, nthMonday(year, 1, 2));
        addHoliday(nationalHolidays, year, 2, 11);
        if (year >= 2020) addHoliday(nationalHolidays, year, 2, 23);
        if (year <= 2018) addHoliday(nationalHolidays, year, 12, 23);

        const vernalEquinox = Math.floor(
            20.8431 + (0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4)
        );
        addHoliday(nationalHolidays, year, 3, vernalEquinox);
        addHoliday(nationalHolidays, year, 4, 29);
        addHoliday(nationalHolidays, year, 5, 3);
        addHoliday(nationalHolidays, year, 5, 4);
        addHoliday(nationalHolidays, year, 5, 5);

        if (year === 2020) {
            addHoliday(nationalHolidays, year, 7, 23);
            addHoliday(nationalHolidays, year, 7, 24);
            addHoliday(nationalHolidays, year, 8, 10);
        } else if (year === 2021) {
            addHoliday(nationalHolidays, year, 7, 22);
            addHoliday(nationalHolidays, year, 7, 23);
            addHoliday(nationalHolidays, year, 8, 8);
        } else {
            addHoliday(
                nationalHolidays,
                year,
                7,
                year >= 2003 ? nthMonday(year, 7, 3) : 20
            );
            if (year >= 2016) addHoliday(nationalHolidays, year, 8, 11);
            addHoliday(nationalHolidays, year, 10, nthMonday(year, 10, 2));
        }

        addHoliday(
            nationalHolidays,
            year,
            9,
            year >= 2003 ? nthMonday(year, 9, 3) : 15
        );
        const autumnEquinox = Math.floor(
            23.2488 + (0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4)
        );
        addHoliday(nationalHolidays, year, 9, autumnEquinox);
        addHoliday(nationalHolidays, year, 11, 3);
        addHoliday(nationalHolidays, year, 11, 23);

        if (year === 2019) {
            addHoliday(nationalHolidays, year, 5, 1);
            addHoliday(nationalHolidays, year, 10, 22);
        }

        const holidays = new Set(nationalHolidays);
        let cursor = new Date(year, 0, 2, 12);
        const lastCitizenHolidayCandidate = new Date(year, 11, 30, 12);
        while (cursor <= lastCitizenHolidayCandidate) {
            const currentKey = dateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
            const previous = addDays(cursor, -1);
            const next = addDays(cursor, 1);
            const previousKey = dateKey(previous.getFullYear(), previous.getMonth() + 1, previous.getDate());
            const nextKey = dateKey(next.getFullYear(), next.getMonth() + 1, next.getDate());
            if (
                !nationalHolidays.has(currentKey)
                && nationalHolidays.has(previousKey)
                && nationalHolidays.has(nextKey)
            ) {
                holidays.add(currentKey);
            }
            cursor = addDays(cursor, 1);
        }

        [...nationalHolidays].sort().forEach((holidayKey) => {
            const holiday = parseDateKey(holidayKey);
            if (holiday.getDay() !== 0) return;
            let substitute = addDays(holiday, 1);
            let substituteKey = dateKey(
                substitute.getFullYear(),
                substitute.getMonth() + 1,
                substitute.getDate()
            );
            while (holidays.has(substituteKey)) {
                substitute = addDays(substitute, 1);
                substituteKey = dateKey(
                    substitute.getFullYear(),
                    substitute.getMonth() + 1,
                    substitute.getDate()
                );
            }
            holidays.add(substituteKey);
        });

        cache.set(year, holidays);
        return holidays;
    }

    return {
        has(dateText) {
            const year = Number(String(dateText).slice(0, 4));
            return Number.isInteger(year) && holidaysForYear(year).has(dateText);
        },
        forYear(year) {
            return new Set(holidaysForYear(year));
        }
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = JapaneseHolidays;
}

(function () {
    "use strict";

    if (typeof document === "undefined") return;

    const DATA_URL = `data/calendar.json?v=${Date.now()}`;
    const BACKUP_DATE_SUFFIX = "￤予備日";
    const TAG_CLASS = {
        "GM": "tag-gm",
        "PL": "tag-pl",
        "仮押さえ": "tag-hold",
        "×": "tag-blocked"
    };
    const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

    const root = document.getElementById("calendar-root");
    const calendarShell = document.querySelector(".calendar-shell");
    const status = document.getElementById("calendar-status");
    const updated = document.getElementById("calendar-updated");
    const monthLabel = document.getElementById("month-label");
    const previousButton = document.getElementById("month-prev");
    const nextButton = document.getElementById("month-next");
    const todayButton = document.getElementById("month-today");
    const jumpButton = document.getElementById("month-jump");
    const jumpDialog = document.getElementById("month-jump-dialog");
    const jumpInput = document.getElementById("month-jump-input");
    const template = document.getElementById("event-template");
    const monthlyNote = document.getElementById("monthly-note");
    const monthlyNoteTitle = document.getElementById("monthly-note-title");
    const monthlyNoteText = document.getElementById("monthly-note-text");

    let events = [];
    let eventsByDate = new Map();
    let monthlyNotes = {};
    let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let pointerStart = null;
    let wheelDelta = 0;
    let wheelCooldown = false;
    let wheelResetTimer = null;

    function currentMonthStart() {
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }

    function clampToCurrentOrFutureMonth(monthDate) {
        const minimumMonth = currentMonthStart();
        return monthDate < minimumMonth ? minimumMonth : monthDate;
    }

    function parseDate(dateText) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || "")) return null;
        const [year, month, day] = dateText.split("-").map(Number);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return null;
        }
        return date;
    }

    function parseMonthKey(monthKey) {
        if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
        const [year, month] = monthKey.split("-").map(Number);
        if (month < 1 || month > 12) return null;
        return new Date(year, month - 1, 1);
    }

    function toDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function toMonthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function isValidStartTime(value) {
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
    }

    function isValidEndTime(value) {
        return /^([0-3]\d|4[0-7]):[0-5]\d$/.test(value || "");
    }

    function usesExtendedEndHour(value) {
        return isValidEndTime(value) && Number(value.slice(0, 2)) >= 24;
    }

    function normalizeMonthlyNotes(rawMonthlyNotes) {
        if (!rawMonthlyNotes || typeof rawMonthlyNotes !== "object" || Array.isArray(rawMonthlyNotes)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(rawMonthlyNotes)
                .filter(([monthKey, note]) => parseMonthKey(monthKey) && typeof note === "string" && note.trim())
                .map(([monthKey, note]) => [monthKey, note.trim()])
        );
    }

    function normalizeEvents(rawEvents) {
        if (!Array.isArray(rawEvents)) return [];

        return rawEvents.flatMap((event, eventIndex) => {
            if (!event || typeof event !== "object" || !TAG_CLASS[event.tag]) return [];

            const dates = Array.isArray(event.dates) ? event.dates : [];
            const normalizedDates = [...new Set(dates)]
                .filter((dateText) => parseDate(dateText))
                .sort();
            const allDay = Boolean(event.all_day) || !isValidStartTime(event.start_time);
            const startTime = allDay ? "" : event.start_time;
            const endTime = allDay || !isValidEndTime(event.end_time) ? "" : event.end_time;

            return normalizedDates.map((dateText, dateIndex) => ({
                id: String(event.id || `${eventIndex}-${dateIndex}`),
                date: dateText,
                tag: event.tag,
                title: String(event.title || (event.tag === "×" ? "予定あり" : "名称未設定")),
                details: String(event.details || ""),
                allDay,
                startTime,
                endTime,
                endNextDay: Boolean(event.end_next_day) || usesExtendedEndHour(endTime),
                isBackupDate: Boolean(event.is_backup_date)
            }));
        }).sort((a, b) => {
            const dateOrder = a.date.localeCompare(b.date);
            if (dateOrder !== 0) return dateOrder;
            const timeOrder = (a.startTime || "00:00").localeCompare(b.startTime || "00:00");
            if (timeOrder !== 0) return timeOrder;
            return a.title.localeCompare(b.title, "ja");
        });
    }

    function formatTime(event) {
        if (event.allDay || !event.startTime) return "終日";
        if (!event.endTime) return event.startTime;
        const nextDayPrefix = event.endNextDay && !usesExtendedEndHour(event.endTime) ? "翌" : "";
        return `${event.startTime}-${nextDayPrefix}${event.endTime}`;
    }

    function formatEventTitle(event) {
        if (!event.isBackupDate || event.title.endsWith(BACKUP_DATE_SUFFIX)) {
            return event.title;
        }
        return `${event.title}${BACKUP_DATE_SUFFIX}`;
    }

    function createEventCard(event) {
        const card = template.content.firstElementChild.cloneNode(true);
        card.classList.add(TAG_CLASS[event.tag]);

        const formattedTime = formatTime(event);
        const formattedTitle = formatEventTitle(event);
        card.querySelector(".event-title").textContent = formattedTitle;
        const time = card.querySelector(".event-time");
        time.textContent = formattedTime;
        time.dateTime = event.allDay ? event.date : `${event.date}T${event.startTime}:00`;
        card.querySelector(".event-details").textContent = event.details;
        card.setAttribute("aria-label", `${event.tag} ${formattedTitle} ${formattedTime}`);
        return card;
    }

    function createMonthSection(monthDate) {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth() + 1;
        const section = document.createElement("section");
        section.className = "month-section";
        section.setAttribute("aria-labelledby", "month-label");

        const weekdayRow = document.createElement("div");
        weekdayRow.className = "weekday-row";
        weekdayRow.setAttribute("aria-hidden", "true");
        WEEKDAYS.forEach((weekday) => {
            const cell = document.createElement("div");
            cell.className = "weekday";
            cell.textContent = weekday;
            weekdayRow.appendChild(cell);
        });

        const grid = document.createElement("div");
        grid.className = "month-grid";
        grid.setAttribute("role", "grid");
        const firstDay = (new Date(year, month - 1, 1).getDay() + 6) % 7;
        const lastDate = new Date(year, month, 0).getDate();
        const numberOfWeeks = Math.ceil((firstDay + lastDate) / 7);
        const totalCells = numberOfWeeks * 7;
        const todayKey = toDateKey(new Date());
        grid.style.setProperty("--calendar-weeks", String(numberOfWeeks));

        for (let index = 0; index < firstDay; index += 1) {
            const emptyCell = document.createElement("div");
            emptyCell.className = "calendar-day is-empty";
            emptyCell.setAttribute("aria-hidden", "true");
            grid.appendChild(emptyCell);
        }

        for (let day = 1; day <= lastDate; day += 1) {
            const date = new Date(year, month - 1, day);
            const dateKey = toDateKey(date);
            const dayEvents = eventsByDate.get(dateKey) || [];
            const dayCell = document.createElement("div");
            dayCell.className = "calendar-day";
            dayCell.setAttribute("role", "gridcell");
            const weekdayIndex = (date.getDay() + 6) % 7;
            const isHoliday = JapaneseHolidays.has(dateKey);
            const holidayLabel = isHoliday ? " 祝日" : "";
            dayCell.setAttribute(
                "aria-label",
                `${year}年${month}月${day}日 ${WEEKDAYS[weekdayIndex]}曜日${holidayLabel}`
            );

            if (date.getDay() === 0) dayCell.classList.add("is-sunday");
            if (date.getDay() === 6) dayCell.classList.add("is-saturday");
            if (date.getDay() === 0 || date.getDay() === 6) dayCell.classList.add("is-weekend");
            if (isHoliday) dayCell.classList.add("is-holiday");
            if (dateKey === todayKey) dayCell.classList.add("is-today");
            if (dayEvents.length) dayCell.classList.add("has-events");
            if (dayEvents.length >= 3) dayCell.classList.add("is-crowded");

            const dayNumber = document.createElement("span");
            dayNumber.className = "day-number";
            dayNumber.textContent = String(day);
            dayNumber.setAttribute("aria-hidden", "true");

            const eventsContainer = document.createElement("div");
            eventsContainer.className = "day-events";
            eventsContainer.style.setProperty("--event-count", String(Math.max(dayEvents.length, 1)));
            dayEvents.forEach((event) => eventsContainer.appendChild(createEventCard(event)));
            dayCell.append(dayNumber, eventsContainer);
            grid.appendChild(dayCell);
        }

        for (let index = firstDay + lastDate; index < totalCells; index += 1) {
            const emptyCell = document.createElement("div");
            emptyCell.className = "calendar-day is-empty";
            emptyCell.setAttribute("aria-hidden", "true");
            grid.appendChild(emptyCell);
        }

        section.append(weekdayRow, grid);
        return section;
    }

    function chooseInitialMonth() {
        const hashMonth = parseMonthKey(window.location.hash.replace(/^#/, ""));
        if (hashMonth) return clampToCurrentOrFutureMonth(hashMonth);

        const today = new Date();
        const currentMonthKey = toMonthKey(today);
        if (events.some((event) => event.date.startsWith(currentMonthKey))) {
            return new Date(today.getFullYear(), today.getMonth(), 1);
        }

        const todayKey = toDateKey(today);
        const nextEvent = events.find((event) => event.date >= todayKey);
        if (nextEvent) return parseMonthKey(nextEvent.date.slice(0, 7));
        if (events.length) return parseMonthKey(events[events.length - 1].date.slice(0, 7));
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }

    function renderVisibleMonth(updateHash) {
        const requestedMonthKey = toMonthKey(visibleMonth);
        visibleMonth = clampToCurrentOrFutureMonth(visibleMonth);
        if (requestedMonthKey !== toMonthKey(visibleMonth)) updateHash = true;
        const year = visibleMonth.getFullYear();
        const month = visibleMonth.getMonth() + 1;
        const monthKey = toMonthKey(visibleMonth);
        monthLabel.textContent = `${year}年${month}月`;
        root.setAttribute("aria-label", `${year}年${month}月の予定カレンダー`);
        root.replaceChildren(createMonthSection(visibleMonth));
        const note = monthlyNotes[monthKey] || "";
        monthlyNoteTitle.textContent = `${year}年${month}月のメモ`;
        monthlyNoteText.textContent = note;
        monthlyNoteText.scrollTop = 0;
        monthlyNoteText.tabIndex = note ? 0 : -1;
        monthlyNote.hidden = false;
        status.hidden = true;
        root.hidden = false;
        const minimumMonthKey = toMonthKey(currentMonthStart());
        previousButton.disabled = monthKey === minimumMonthKey;
        jumpInput.min = minimumMonthKey;

        if (updateHash) {
            window.history.replaceState(null, "", `#${monthKey}`);
        }
    }

    function moveMonth(offset) {
        visibleMonth = clampToCurrentOrFutureMonth(
            new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1)
        );
        renderVisibleMonth(true);
    }

    function enforceCurrentMonthFloor() {
        const clampedMonth = clampToCurrentOrFutureMonth(visibleMonth);
        if (toMonthKey(clampedMonth) !== toMonthKey(visibleMonth)) {
            visibleMonth = clampedMonth;
            renderVisibleMonth(true);
            return;
        }
        const minimumMonthKey = toMonthKey(currentMonthStart());
        previousButton.disabled = toMonthKey(visibleMonth) === minimumMonthKey;
        jumpInput.min = minimumMonthKey;
    }

    function jumpToMonth(monthKey) {
        const targetMonth = parseMonthKey(monthKey);
        if (!targetMonth) return false;
        visibleMonth = clampToCurrentOrFutureMonth(targetMonth);
        renderVisibleMonth(true);
        return true;
    }

    function renderCalendar(data) {
        events = normalizeEvents(data.events);
        monthlyNotes = normalizeMonthlyNotes(data.monthly_notes);
        eventsByDate = new Map();
        events.forEach((event) => {
            if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
            eventsByDate.get(event.date).push(event);
        });

        document.title = String(data.calendar_name || "卓予定カレンダー");
        updated.textContent = data.updated_at ? `最終更新: ${data.updated_at}` : "";
        const hashMonth = parseMonthKey(window.location.hash.replace(/^#/, ""));
        const hasValidHash = Boolean(
            hashMonth && toMonthKey(hashMonth) === toMonthKey(clampToCurrentOrFutureMonth(hashMonth))
        );
        visibleMonth = chooseInitialMonth();
        renderVisibleMonth(!hasValidHash);
    }

    function showError() {
        status.classList.add("is-error");
        status.textContent = "予定を読み込めませんでした。時間をおいて、もう一度ページを開いてください。";
        monthLabel.textContent = "読み込みエラー";
        monthlyNote.hidden = true;
    }

    previousButton.addEventListener("click", () => moveMonth(-1));
    nextButton.addEventListener("click", () => moveMonth(1));
    todayButton.addEventListener("click", () => {
        const today = new Date();
        visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        renderVisibleMonth(true);
    });
    jumpButton.addEventListener("click", () => {
        jumpInput.value = toMonthKey(visibleMonth);
        if (!jumpDialog.open) jumpDialog.showModal();
        jumpInput.focus();
    });
    jumpInput.addEventListener("change", () => {
        if (jumpToMonth(jumpInput.value)) jumpDialog.close();
    });
    jumpDialog.addEventListener("click", (event) => {
        if (event.target === jumpDialog) jumpDialog.close();
    });

    calendarShell.addEventListener("wheel", (event) => {
        if (root.hidden || jumpDialog.open || event.ctrlKey) return;
        if (event.target.closest(".monthly-note")) return;
        if (!event.deltaY || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        if (wheelCooldown) return;

        const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? Math.max(root.clientHeight, 1)
                : 1;
        wheelDelta += event.deltaY * scale;
        window.clearTimeout(wheelResetTimer);
        wheelResetTimer = window.setTimeout(() => {
            wheelDelta = 0;
        }, 140);
        if (Math.abs(wheelDelta) < 40) return;

        moveMonth(wheelDelta < 0 ? -1 : 1);
        wheelDelta = 0;
        wheelCooldown = true;
        window.setTimeout(() => {
            wheelCooldown = false;
        }, 180);
    }, { passive: false });

    root.addEventListener("pointerdown", (event) => {
        pointerStart = { x: event.clientX, y: event.clientY };
    });

    root.addEventListener("pointerup", (event) => {
        if (!pointerStart) return;
        const deltaX = event.clientX - pointerStart.x;
        const deltaY = event.clientY - pointerStart.y;
        pointerStart = null;
        if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY)) {
            moveMonth(deltaX < 0 ? 1 : -1);
        }
    });

    root.addEventListener("pointercancel", () => {
        pointerStart = null;
    });

    document.addEventListener("keydown", (event) => {
        if (jumpDialog.open) return;
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveMonth(-1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            moveMonth(1);
        }
    });

    window.addEventListener("hashchange", () => {
        const hashMonth = parseMonthKey(window.location.hash.replace(/^#/, ""));
        if (hashMonth) {
            const targetMonth = clampToCurrentOrFutureMonth(hashMonth);
            const hashWasClamped = toMonthKey(targetMonth) !== toMonthKey(hashMonth);
            if (toMonthKey(targetMonth) !== toMonthKey(visibleMonth) || hashWasClamped) {
                visibleMonth = targetMonth;
                renderVisibleMonth(hashWasClamped);
            }
        }
    });

    window.setInterval(enforceCurrentMonthFloor, 60_000);

    fetch(DATA_URL, { cache: "no-store" })
        .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then((data) => renderCalendar(data && typeof data === "object" ? data : {}))
        .catch((error) => {
            console.error("Calendar data could not be loaded:", error);
            showError();
        });
}());
