"use client";

import { useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";

import { dateKey, keyToDate } from "@/lib/dates";
import type { DayRecord, OptuneSessionRecord, Records } from "@/lib/records";
import { getOverlapMs, getPeriod, summarize, summarizeRunning } from "@/lib/utility";
import type { Scope } from "@/lib/utility";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pullRefreshThreshold = 70;
const pullRefreshMax = 96;
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

type SessionDraft = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function startOfWeek(date: Date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
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

function formatSessionRange(session: OptuneSessionRecord, showFullDates = false) {
  const start = new Date(session.start);
  const startLabel = `${formatShortDate(start)}, ${formatTime(session.start)}`;

  if (!session.end) {
    return `${startLabel} - now`;
  }

  const end = new Date(session.end);
  const endLabel = `${formatShortDate(end)}, ${formatTime(session.end)}`;

  if (!showFullDates && dateKey(start) === dateKey(end)) {
    return `${formatTime(session.start)} - ${formatTime(session.end)}`;
  }

  return `${startLabel} - ${endLabel}`;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toTimeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function makeSessionDraft(session: OptuneSessionRecord): SessionDraft {
  const start = new Date(session.start);
  const end = session.end ? new Date(session.end) : null;

  return {
    startDate: toDateInputValue(start),
    startTime: toTimeInputValue(start),
    endDate: end ? toDateInputValue(end) : "",
    endTime: end ? toTimeInputValue(end) : ""
  };
}

function draftToIso(draft: SessionDraft) {
  if (!draft.startDate || !draft.startTime) {
    throw new Error("Start date and time are required.");
  }

  const start = new Date(`${draft.startDate}T${draft.startTime}`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Start date and time are invalid.");
  }

  const hasEnd = Boolean(draft.endDate || draft.endTime);
  if (!hasEnd) {
    return { start: start.toISOString(), end: null };
  }

  if (!draft.endDate || !draft.endTime) {
    throw new Error("End date and time must both be set.");
  }

  const end = new Date(`${draft.endDate}T${draft.endTime}`);
  if (Number.isNaN(end.getTime())) {
    throw new Error("End date and time are invalid.");
  }

  if (end <= start) {
    throw new Error("End time must be after start time.");
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function emptyRecord(): DayRecord {
  return { sessions: [] };
}

function getOpenSession(records: Records) {
  for (const [key, record] of Object.entries(records)) {
    const index = record.sessions.findIndex((session) => !session.end);
    if (index >= 0) {
      return { key, index, session: record.sessions[index] };
    }
  }

  return null;
}

function togglePatchRecord(records: Records, key: string, changedAt: string): Records {
  const record = records[key] ?? emptyRecord();

  if (record.patchChanged) {
    const next = { ...records };
    if (record.sessions.length) {
      next[key] = { ...record, patchChanged: false, patchChangedAt: undefined };
    } else {
      delete next[key];
    }
    return next;
  }

  return {
    ...records,
    [key]: {
      ...record,
      patchChanged: true,
      patchChangedAt: changedAt
    }
  };
}

function toggleOptuneRecord(records: Records, now: Date): Records {
  const active = getOpenSession(records);
  const nowIso = now.toISOString();

  if (active) {
    const activeId = active.session?.id;
    return {
      ...records,
      ...Object.fromEntries(
        Object.entries(records).map(([key, record]) => [
          key,
          {
            ...record,
            sessions: record.sessions.map((session, index) =>
              session.id === activeId || (key === active.key && index === active.index)
                ? { ...session, end: nowIso }
                : session
            )
          }
        ])
      )
    };
  }

  const key = dateKey(now);
  const record = records[key] ?? emptyRecord();

  return {
    ...records,
    [key]: {
      ...record,
      sessions: [...record.sessions, { id: `optimistic-${nowIso}`, start: nowIso }]
    }
  };
}

function makeCalendarWeeks(viewDate: Date) {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const monthEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const cursor = startOfWeek(monthStart);
  const weeks: Date[][] = [];

  while (cursor <= monthEnd || cursor.getDay() !== 1) {
    const week: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > monthEnd && cursor.getDay() === 1) {
      break;
    }
  }

  return weeks;
}

function getPeriodSessions(records: Records, date: Date, scope: Scope) {
  const { start, end } = getPeriod(date, scope);
  const sessions = new Map<string, OptuneSessionRecord>();

  Object.values(records).forEach((record) => {
    record.sessions.forEach((session) => {
      if (sessions.has(session.id)) {
        return;
      }

      if (getOverlapMs(session, start, end) > 0) {
        sessions.set(session.id, session);
      }
    });
  });

  return Array.from(sessions.values()).sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime()
  );
}

function getPeriodPatchChanges(records: Records, date: Date, scope: Scope) {
  const { start, end } = getPeriod(date, scope);

  return Object.entries(records)
    .filter(([key, record]) => {
      const recordDate = keyToDate(key);
      return record.patchChanged && recordDate >= start && recordDate < end;
    })
    .map(([key, record]) => ({ key, changedAt: record.patchChangedAt }))
    .sort((left, right) => keyToDate(left.key).getTime() - keyToDate(right.key).getTime());
}

function formatPatchChangeSummary(change: { key: string; changedAt?: string }, showDate: boolean) {
  const dayLabel = formatShortDate(keyToDate(change.key));
  const timeLabel = change.changedAt ? formatTime(change.changedAt) : null;

  if (!timeLabel) {
    return showDate ? `Patches changed on ${dayLabel}.` : "Patches changed.";
  }

  return showDate ? `Patches changed on ${dayLabel} at ${timeLabel}.` : `Patches changed at ${timeLabel}.`;
}

async function postRecords(url: string, body?: unknown) {
  return requestRecords(url, "POST", body);
}

async function requestRecords(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
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
  const [editingSession, setEditingSession] = useState<OptuneSessionRecord | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartX = useRef<number | null>(null);
  const pullStartY = useRef<number | null>(null);
  const isPulling = useRef(false);
  const openSession = getOpenSession(records);

  const selectedDate = keyToDate(selectedKey);
  const selectedRecord = records[selectedKey] ?? emptyRecord();
  const didChangePatchesSelectedDay = Boolean(selectedRecord.patchChanged);
  const weeks = useMemo(() => makeCalendarWeeks(viewDate), [viewDate]);
  const statsDate = scope === "month" || scope === "year" ? viewDate : selectedDate;
  const stats = summarize(records, statsDate, scope);
  const runningStats = summarizeRunning(records, statsDate, scope);
  const showRunningStats = scope === "week" || scope === "month" || scope === "year";
  const activitySessions = scope === "day" || scope === "week" ? getPeriodSessions(records, statsDate, scope) : [];
  const patchChanges = getPeriodPatchChanges(records, statsDate, scope);

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
    const changedAt = new Date().toISOString();
    setScope("day");
    void runMutation(
      () => postRecords("/api/patch", { dateKey: selectedKey }),
      (current) => togglePatchRecord(current, selectedKey, changedAt)
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

  function editSession(session: OptuneSessionRecord) {
    setError("");
    setEditingSession(session);
    setSessionDraft(makeSessionDraft(session));
  }

  function closeSessionEditor() {
    setEditingSession(null);
    setSessionDraft(null);
  }

  function updateSessionDraft(field: keyof SessionDraft, value: string) {
    setSessionDraft((draft) => (draft ? { ...draft, [field]: value } : draft));
  }

  async function saveSession() {
    if (!editingSession || !sessionDraft) {
      return;
    }

    try {
      setError("");
      setIsSaving(true);
      const { start, end } = draftToIso(sessionDraft);
      setRecords(await requestRecords("/api/optune/session", "PATCH", { id: editingSession.id, start, end }));
      closeSessionEditor();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSession() {
    if (!editingSession) {
      return;
    }

    try {
      setError("");
      setIsSaving(true);
      setRecords(await requestRecords("/api/optune/session", "DELETE", { id: editingSession.id }));
      closeSessionEditor();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshRecords() {
    if (isSaving) {
      return;
    }

    try {
      setError("");
      setIsSaving(true);
      setRecords(await requestRecords("/api/records", "GET"));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (!touch || window.scrollY > 0 || isSaving || editingSession) {
      pullStartX.current = null;
      pullStartY.current = null;
      isPulling.current = false;
      return;
    }

    pullStartX.current = touch.clientX;
    pullStartY.current = touch.clientY;
    isPulling.current = false;
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (!touch || pullStartX.current === null || pullStartY.current === null || window.scrollY > 0) {
      return;
    }

    const deltaX = Math.abs(touch.clientX - pullStartX.current);
    const deltaY = touch.clientY - pullStartY.current;

    if (deltaY <= 0) {
      setPullDistance(0);
      return;
    }

    if (deltaX > deltaY) {
      return;
    }

    if (deltaY > 12) {
      event.preventDefault();
      isPulling.current = true;
      setPullDistance(Math.min(pullRefreshMax, deltaY * 0.45));
    }
  }

  function handleTouchEnd() {
    const shouldRefresh = isPulling.current && pullDistance >= pullRefreshThreshold && !isSaving;
    pullStartX.current = null;
    pullStartY.current = null;
    isPulling.current = false;
    setPullDistance(0);

    if (shouldRefresh) {
      void refreshRecords();
    }
  }

  return (
    <main className="screen" onTouchCancel={handleTouchEnd} onTouchEnd={handleTouchEnd} onTouchMove={handleTouchMove} onTouchStart={handleTouchStart}>
      <div className="pullRefreshIndicator" style={{ transform: `translateY(${pullDistance}px)`, opacity: pullDistance ? 1 : 0 }}>
        <span aria-hidden="true">↻</span>
      </div>
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
          <div className="percentGroup">
            <div className="percentBadge">
              <strong>{Math.round(stats.percent)}%</strong>
              {showRunningStats ? <span>Total</span> : null}
            </div>
            {showRunningStats ? (
              <div className="percentBadge runningPercentBadge">
                <strong>{Math.round(runningStats.percent)}%</strong>
                <span>To date</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="statsGrid">
          <div className="statBox">
            <strong>{formatDuration(stats.wearMs)}</strong>
            <span>Optune worn</span>
          </div>
          <div className="statBox">
            <strong>{stats.patchDays}</strong>
            <span>Patch changes</span>
          </div>
          <div className="statBox">
            <strong>{stats.sessionCount}</strong>
            <span>Sessions</span>
          </div>
        </div>

        <div className="detailBlock">
          <h3>Patch summary</h3>
          {patchChanges.length === 0 ? (
            <p className="emptyText">No patch changes recorded for this {scope}.</p>
          ) : patchChanges.length === 1 && patchChanges[0] ? (
            <p className="summaryText">{formatPatchChangeSummary(patchChanges[0], scope !== "day")}</p>
          ) : (
            <div className="summaryList">
              <p className="summaryText">Patches changed {patchChanges.length} times.</p>
              {patchChanges.map((change) => (
                <p className="summaryText" key={change.key}>
                  {formatPatchChangeSummary(change, true)}
                </p>
              ))}
            </div>
          )}
        </div>

        {scope === "day" || scope === "week" ? (
          <div className="detailBlock">
            <h3>Optune activity</h3>
            {activitySessions.length ? (
              activitySessions.map((session) => (
                <button className="sessionRow" key={session.id} onClick={() => editSession(session)}>
                  <span aria-hidden="true">◷</span>
                  <span>{formatSessionRange(session, scope === "week")}</span>
                </button>
              ))
            ) : (
              <p className="emptyText">No Optune sessions recorded for this {scope}.</p>
            )}
          </div>
        ) : null}
      </section>

      <div className="refreshBar">
        <button className="refreshButton" disabled={isSaving} onClick={refreshRecords}>
          <span aria-hidden="true">↻</span>
          <span>Refresh</span>
        </button>
      </div>

      {editingSession && sessionDraft ? (
        <div className="modalOverlay" role="presentation">
          <section className="sessionEditor" aria-label="Edit Optune activity" role="dialog" aria-modal="true">
            <div className="sessionEditorHeader">
              <div>
                <p className="statsLabel">OPTUNE ACTIVITY</p>
                <h2>Edit time</h2>
              </div>
              <button className="iconButton" aria-label="Close editor" disabled={isSaving} onClick={closeSessionEditor}>
                ×
              </button>
            </div>

            <div className="sessionFormGrid">
              <label>
                <span>Start date</span>
                <input
                  disabled={isSaving}
                  type="date"
                  value={sessionDraft.startDate}
                  onChange={(event) => updateSessionDraft("startDate", event.target.value)}
                />
              </label>
              <label>
                <span>Start time</span>
                <input
                  disabled={isSaving}
                  type="time"
                  value={sessionDraft.startTime}
                  onChange={(event) => updateSessionDraft("startTime", event.target.value)}
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  disabled={isSaving}
                  type="date"
                  value={sessionDraft.endDate}
                  onChange={(event) => updateSessionDraft("endDate", event.target.value)}
                />
              </label>
              <label>
                <span>End time</span>
                <input
                  disabled={isSaving}
                  type="time"
                  value={sessionDraft.endTime}
                  onChange={(event) => updateSessionDraft("endTime", event.target.value)}
                />
              </label>
            </div>

            <div className="sessionEditorActions">
              <button className="deleteButton" disabled={isSaving} onClick={deleteSession}>
                Delete
              </button>
              <button className="secondaryButton" disabled={isSaving} onClick={closeSessionEditor}>
                Cancel
              </button>
              <button className="saveButton" disabled={isSaving} onClick={saveSession}>
                Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
