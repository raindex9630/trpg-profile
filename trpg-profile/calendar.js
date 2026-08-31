(function () {
    "use strict";

    const DATA_URL = `data/calendar.json?v=${Date.now()}`;
    const TAG_CLASS = {
        "GM": "tag-gm",
        "PL": "tag-pl",
        "仮押さえ": "tag-hold",
        "×": "tag-blocked"
    };
    const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

    const root = document.getElementById("calendar-root");
    const status = document.getElementById("calendar-status");
    const count = document.getElementById("calendar-count");
    const updated = document.getElementById("calendar-updated");
    const monthLabel = document.getElementById("month-label");
    const previousButton = document.getElementById("month-prev");
    const nextButton = document.getElementById("month-next");
    const todayButton = document.getElementById("month-today");
    const template = document.getElementById("event-template");
    const monthlyNote = document.getElementById("monthly-note");
    const monthlyNoteTitle = document.getElementById("monthly-note-title");
    const monthlyNoteText = document.getElementById("monthly-note-text");

    let events = [];
    let eventsByDate = new Map();
    let monthlyNotes = {};
    let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let pointerStart = null;

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
                endNextDay: Boolean(event.end_next_day) || usesExtendedEndHour(endTime)
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
        return `${event.startTime}–${nextDayPrefix}${event.endTime}`;
    }

    function createEventCard(event) {
        const card = template.content.firstElementChild.cloneNode(true);
        card.classList.add(TAG_CLASS[event.tag]);

        const tag = card.querySelector(".event-tag");
        tag.textContent = event.tag;

        const time = card.querySelector(".event-time");
        time.textContent = formatTime(event);
        time.dateTime = event.allDay ? event.date : `${event.date}T${event.startTime}:00`;

        card.querySelector(".event-title").textContent = event.title;
        card.querySelector(".event-details").textContent = event.details;
        card.setAttribute("aria-label", `${event.tag} ${formatTime(event)} ${event.title}`);
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
            dayCell.setAttribute("aria-label", `${year}年${month}月${day}日 ${WEEKDAYS[weekdayIndex]}曜日`);

            if (date.getDay() === 0) dayCell.classList.add("is-sunday");
            if (date.getDay() === 6) dayCell.classList.add("is-saturday");
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
        if (hashMonth) return hashMonth;

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
        const year = visibleMonth.getFullYear();
        const month = visibleMonth.getMonth() + 1;
        const monthKey = toMonthKey(visibleMonth);
        const visibleCount = events.filter((event) => event.date.startsWith(monthKey)).length;

        monthLabel.textContent = `${year}年${month}月`;
        count.textContent = events.length
            ? `この月 ${visibleCount}件 / 全${events.length}件`
            : "現在、公開中の予定はありません";
        root.setAttribute("aria-label", `${year}年${month}月の予定カレンダー`);
        root.replaceChildren(createMonthSection(visibleMonth));
        const note = monthlyNotes[monthKey] || "";
        monthlyNoteTitle.textContent = `${year}年${month}月のメモ`;
        monthlyNoteText.textContent = note;
        monthlyNote.hidden = !note;
        status.hidden = true;
        root.hidden = false;

        if (updateHash) {
            window.history.replaceState(null, "", `#${monthKey}`);
        }
    }

    function moveMonth(offset) {
        visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
        renderVisibleMonth(true);
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
        updated.textContent = data.updated_at ? `更新: ${data.updated_at}` : "";
        const hasValidHash = Boolean(parseMonthKey(window.location.hash.replace(/^#/, "")));
        visibleMonth = chooseInitialMonth();
        renderVisibleMonth(!hasValidHash);
    }

    function showError() {
        status.classList.add("is-error");
        status.textContent = "予定を読み込めませんでした。時間をおいて、もう一度ページを開いてください。";
        monthLabel.textContent = "読み込みエラー";
        count.textContent = "";
        monthlyNote.hidden = true;
    }

    previousButton.addEventListener("click", () => moveMonth(-1));
    nextButton.addEventListener("click", () => moveMonth(1));
    todayButton.addEventListener("click", () => {
        const today = new Date();
        visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        renderVisibleMonth(true);
    });

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
        if (hashMonth && toMonthKey(hashMonth) !== toMonthKey(visibleMonth)) {
            visibleMonth = hashMonth;
            renderVisibleMonth(false);
        }
    });

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
