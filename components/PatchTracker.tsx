"use client";

import { useMemo, useState } from "react";

import { dateKey, keyToDate } from "@/lib/dates";
import type { DayRecord, OptuneSessionRecord, Records } from "@/lib/records";

type Scope = "day" | "week" | "month" | "year";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function startOfWeek(date: Date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() - day.getDay());
  return day;
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function getPeriod(date: Date, scope: Scope) {
  if (scope === "day") {
    return { start: startOfDay(date), end: endOfDay(date) };
  }

  if (scope === "week") {
    const start = startOfWeek(date);
    return { start, end: addDays(start, 7) };
  }

  if (scope === "month") {
    return {
      start: new Date(date.getFullYear(), date.getMonth(), 1),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 1)
    };
  }

  return {
    start: new Date(date.getFullYear(), 0, 1),
    end: new Date(date.getFullYear() + 1, 0, 1)
  };
}

function getOverlapMs(session: OptuneSessionRecord, periodStart: Date, periodEnd: Date) {
  const start = new Date(session.start).getTime();
  const end = session.end ? new Date(session.end).getTime() : Date.now();
  const overlapStart = Math.max(start, periodStart.getTime());
  const overlapEnd = Math.min(end, periodEnd.getTime());
  return Math.max(0, overlapEnd - overlapStart);
}

function emptyRecord(): DayRecord {
  return { sessions: [] };
}

function getOpenSession(records: Records) {
  for (const [key, record] of Object.entries(records)) {
    const index = record.sessions.findIndex((session) => !session.end);
    if (index >= 0) {
      return { key, index };
    }
  }

  return null;
}

function togglePatchRecord(records: Records, key: string): Records {
  const record = records[key] ?? emptyRecord();

  if (record.patchChanged) {
    const next = { ...records };
    if (record.sessions.length) {
      next[key] = { ...record, patchChanged: false };
    } else {
      delete next[key];
    }
    return next;
  }

  return {
    ...records,
    [key]: {
      ...record,
      patchChanged: true
    }
  };
}

function toggleOptuneRecord(records: Records, now: Date): Records {
  const active = getOpenSession(records);
  const nowIso = now.toISOString();

  if (active) {
    const record = records[active.key] ?? emptyRecord();
    return {
      ...records,
      [active.key]: {
        ...record,
        sessions: record.sessions.map((session, index) =>
          index === active.index ? { ...session, end: nowIso } : session
        )
      }
    };
  }

  const key = dateKey(now);
  const record = records[key] ?? emptyRecord();

  return {
    ...records,
    [key]: {
      ...record,
      sessions: [...record.sessions, { start: nowIso }]
    }
  };
}

function makeCalendarWeeks(viewDate: Date) {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const monthEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const cursor = startOfWeek(monthStart);
  const weeks: Date[][] = [];

  while (cursor <= monthEnd || cursor.getDay() !== 0) {
    const week: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > monthEnd && cursor.getDay() === 0) {
      break;
    }
  }

  return weeks;
}

function summarize(records: Records, date: Date, scope: Scope) {
  const { start, end } = getPeriod(date, scope);
  let wearMs = 0;
  let patchDays = 0;
  let sessionCount = 0;

  Object.entries(records).forEach(([key, record]) => {
    const recordDate = keyToDate(key);
    if (record.patchChanged && recordDate >= start && recordDate < end) {
      patchDays += 1;
    }

    record.sessions.forEach((session) => {
      const overlap = getOverlapMs(session, start, end);
      if (overlap > 0) {
        wearMs += overlap;
        sessionCount += 1;
      }
    });
  });

  const periodMs = end.getTime() - start.getTime();
  const percent = periodMs > 0 ? Math.min(100, (wearMs / periodMs) * 100) : 0;

  return {
    wearMs,
    patchDays,
    sessionCount,
    percent,
    start,
    end
  };
}

async function postRecords(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as Records;
}

export default function PatchTracker({ initialRecords }: { initialRecords: Records }) {
  const todayKey = dateKey(new Date());
  const [records, setRecords] = useState<Records>(initialRecords);
  const [viewDate, setViewDate] = useState(startOfDay(new Date()));
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [scope, setScope] = useState<Scope>("day");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const openSession = getOpenSession(records);

  const selectedDate = keyToDate(selectedKey);
  const selectedRecord = records[selectedKey] ?? emptyRecord();
  const didChangePatchesSelectedDay = Boolean(selectedRecord.patchChanged);
  const weeks = useMemo(() => makeCalendarWeeks(viewDate), [viewDate]);
  const statsDate = scope === "month" || scope === "year" ? viewDate : selectedDate;
  const stats = summarize(records, statsDate, scope);

  const scopeTitle =
    scope === "day"
      ? selectedDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
      : scope === "week"
        ? `${formatShortDate(stats.start)} - ${formatShortDate(addDays(stats.end, -1))}`
        : scope === "month"
          ? `${monthLabels[viewDate.getMonth()]} ${viewDate.getFullYear()}`
          : `${viewDate.getFullYear()}`;

  async function runMutation(mutation: () => Promise<Records>, optimisticUpdate: (current: Records) => Records) {
    const previousRecords = records;
    setError("");
    setIsSaving(true);
    setRecords(optimisticUpdate);

    try {
      setRecords(await mutation());
    } catch (mutationError) {
      setRecords(previousRecords);
      setError(mutationError instanceof Error ? mutationError.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  function togglePatchChanged() {
    setScope("day");
    void runMutation(
      () => postRecords("/api/patch", { dateKey: selectedKey }),
      (current) => togglePatchRecord(current, selectedKey)
    );
  }

  function toggleOptune() {
    const now = new Date();
    setSelectedKey(todayKey);
    setScope("day");
    void runMutation(
      () => postRecords("/api/optune/toggle"),
      (current) => toggleOptuneRecord(current, now)
    );
  }

  function selectDay(day: Date) {
    setSelectedKey(dateKey(day));
    setScope("day");
    setViewDate(new Date(day.getFullYear(), day.getMonth(), 1));
  }

  function selectWeek(day: Date) {
    setSelectedKey(dateKey(day));
    setScope("week");
  }

  return (
    <main className="screen">
      <header className="header">
        <div>
          <h1>Patches</h1>
          <p>Patch changes and Optune wear time</p>
        </div>
        {isSaving ? <span className="saving">Saving</span> : null}
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="actions" aria-label="Actions">
        <button
          className={`actionButton ${didChangePatchesSelectedDay ? "patchUndoButton" : "patchButton"}`}
          disabled={isSaving}
          onClick={togglePatchChanged}
        >
          <span aria-hidden="true">+</span>
          <span>Changed patches</span>
        </button>
        <button
          className={`actionButton ${openSession ? "optuneOffButton" : "optuneOnButton"}`}
          disabled={isSaving}
          onClick={toggleOptune}
        >
          <span aria-hidden="true">{openSession ? "||" : ">"}</span>
          <span>{openSession ? "Turned off Optune" : "Turn on Optune"}</span>
        </button>
      </section>

      <section className="calendarPanel" aria-label="Calendar">
        <div className="monthBar">
          <button className="iconButton" aria-label="Previous month" onClick={() => setViewDate((date) => addMonths(date, -1))}>
            ‹
          </button>
          <div className="monthTitle">
            <button className="monthButton" onClick={() => setScope("month")}>
              {monthLabels[viewDate.getMonth()]}
            </button>
            <button className="yearButton" onClick={() => setScope("year")}>
              {viewDate.getFullYear()}
            </button>
          </div>
          <button className="iconButton" aria-label="Next month" onClick={() => setViewDate((date) => addMonths(date, 1))}>
            ›
          </button>
        </div>

        <div className="weekHeader">
          <div className="weekRailHeader" />
          {dayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        {weeks.map((week) => {
          const firstDay = week[0];
          if (!firstDay) {
            return null;
          }

          const weekKey = dateKey(firstDay);
          return (
            <div className="weekRow" key={weekKey}>
              <button
                aria-label={`Show week statistics from ${formatShortDate(firstDay)}`}
                className={`weekRail ${scope === "week" && dateKey(startOfWeek(selectedDate)) === weekKey ? "weekRailActive" : ""}`}
                onClick={() => selectWeek(firstDay)}
              >
                W
              </button>
              {week.map((day) => {
                const key = dateKey(day);
                const record = records[key];
                const isSelected = selectedKey === key;
                const isToday = key === todayKey;
                const isCurrentMonth = day.getMonth() === viewDate.getMonth();

                return (
                  <button
                    className={[
                      "dayCell",
                      !isCurrentMonth ? "dayCellMuted" : "",
                      isToday ? "todayDay" : "",
                      record?.patchChanged ? "patchDay" : "",
                      isSelected ? "selectedDay" : ""
                    ].join(" ")}
                    key={key}
                    onClick={() => selectDay(day)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className="statsPanel" aria-label="Statistics">
        <div className="statsHeader">
          <div>
            <p className="statsLabel">{scope.toUpperCase()} STATS</p>
            <h2>{scopeTitle}</h2>
          </div>
          <div className="percentBadge">{Math.round(stats.percent)}%</div>
        </div>

        <div className="statsGrid">
          <div className="statBox">
            <strong>{formatDuration(stats.wearMs)}</strong>
            <span>Optune worn</span>
          </div>
          <div className="statBox">
            <strong>{stats.patchDays}</strong>
            <span>Patch days</span>
          </div>
          <div className="statBox">
            <strong>{stats.sessionCount}</strong>
            <span>Sessions</span>
          </div>
        </div>

        {scope === "day" ? (
          <div className="detailBlock">
            <h3>Optune activity</h3>
            {selectedRecord.sessions.length ? (
              selectedRecord.sessions.map((session, index) => (
                <div className="sessionRow" key={`${session.start}-${index}`}>
                  <span aria-hidden="true">◷</span>
                  <span>
                    {formatTime(session.start)} - {session.end ? formatTime(session.end) : "now"}
                  </span>
                </div>
              ))
            ) : (
              <p className="emptyText">No Optune sessions recorded for this day.</p>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
