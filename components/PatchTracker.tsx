"use client";

import {
  ArrowClockwise,
  Bandaids,
  CaretLeft,
  CaretRight,
  Clock,
  Pill,
  Play,
  SneakerMove,
  Stop,
  X
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";

import { dateKey, keyToDate } from "@/lib/dates";
import type { DailyActionRecord, DailyActionType, DayRecord, OptuneSessionRecord, Records } from "@/lib/records";
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

type ActionDraft = {
  occurredDate: string;
  occurredTime: string;
};

type CalendarMarker = "patch" | "optune" | "exercise" | "medicine";

const actionLabels: Record<DailyActionType, string> = {
  EXERCISE: "Exercise",
  MEDICINE: "Medicine"
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

function getWeekNumber(date: Date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() + 3 - ((day.getDay() + 6) % 7));
  const weekOne = new Date(day.getFullYear(), 0, 4);

  return 1 + Math.round(((day.getTime() - weekOne.getTime()) / 86400000 - 3 + ((weekOne.getDay() + 6) % 7)) / 7);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatDuration(ms: number) {
  let remainingMinutes = Math.max(0, Math.round(ms / 60000));
  const units = [
    { label: "y", minutes: 365 * 24 * 60 },
    { label: "mo", minutes: 30 * 24 * 60 },
    { label: "d", minutes: 24 * 60 },
    { label: "h", minutes: 60 },
    { label: "m", minutes: 1 }
  ];
  const parts: string[] = [];

  units.forEach((unit) => {
    const value = Math.floor(remainingMinutes / unit.minutes);
    if (value > 0) {
      parts.push(`${value}${unit.label}`);
      remainingMinutes -= value * unit.minutes;
    }
  });

  return parts.length ? parts.join(" ") : "0m";
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

function makeActionDraft(action: DailyActionRecord): ActionDraft {
  const occurredAt = new Date(action.occurredAt);

  return {
    occurredDate: toDateInputValue(occurredAt),
    occurredTime: toTimeInputValue(occurredAt)
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

function actionDraftToIso(draft: ActionDraft) {
  if (!draft.occurredDate || !draft.occurredTime) {
    throw new Error("Date and time are required.");
  }

  const occurredAt = new Date(`${draft.occurredDate}T${draft.occurredTime}`);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("Date and time are invalid.");
  }

  return occurredAt.toISOString();
}

function emptyRecord(): DayRecord {
  return { sessions: [], actions: [] };
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
    if (record.sessions.length || record.actions?.length) {
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

function addDailyActionRecord(records: Records, key: string, type: DailyActionType, occurredAt: string): Records {
  const record = records[key] ?? emptyRecord();

  return {
    ...records,
    [key]: {
      ...record,
      actions: [...(record.actions ?? []), { id: `optimistic-${type}-${occurredAt}`, type, occurredAt }]
    }
  };
}

function toggleDailyActionRecord(records: Records, key: string, type: DailyActionType, occurredAt: string): Records {
  const record = records[key] ?? emptyRecord();
  const actions = record.actions ?? [];

  if (actions.some((action) => action.type === type)) {
    const nextActions = actions.filter((action) => action.type !== type);
    const next = { ...records };

    if (!record.patchChanged && record.sessions.length === 0 && nextActions.length === 0) {
      delete next[key];
    } else {
      next[key] = { ...record, actions: nextActions };
    }

    return next;
  }

  return addDailyActionRecord(records, key, type, occurredAt);
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

function getPeriodActions(records: Records, date: Date, scope: Scope) {
  const { start, end } = getPeriod(date, scope);

  return Object.values(records)
    .flatMap((record) => record.actions ?? [])
    .filter((action) => {
      const occurredAt = new Date(action.occurredAt);
      return occurredAt >= start && occurredAt < end;
    })
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
}

function formatPatchChangeDate(change: { key: string; changedAt?: string }) {
  const dayLabel = formatShortDate(keyToDate(change.key));
  const timeLabel = change.changedAt ? formatTime(change.changedAt) : null;

  return timeLabel ? `${dayLabel} at ${timeLabel}` : dayLabel;
}

function formatActionDate(action: DailyActionRecord) {
  const actionDate = new Date(action.occurredAt);
  const timeLabel = formatTime(action.occurredAt);

  return `${formatShortDate(actionDate)} at ${timeLabel}`;
}

function formatCount(count: number) {
  return `${count} ${count === 1 ? "time" : "times"}`;
}

function ActivityRow({
  icon,
  children,
  disabled = false,
  onClick
}: {
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="activityRow" disabled={disabled} onClick={onClick}>
      <span className="activityRowIcon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}

function makeActionOccurrenceIso(key: string, now: Date) {
  const occurredAt = keyToDate(key);
  occurredAt.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return occurredAt.toISOString();
}

function getCalendarMarkers(record?: DayRecord): CalendarMarker[] {
  if (!record) {
    return [];
  }

  const actions = record.actions ?? [];
  const markers: CalendarMarker[] = [];

  if (record.patchChanged) {
    markers.push("patch");
  }

  if (record.sessions.length) {
    markers.push("optune");
  }

  if (actions.some((action) => action.type === "EXERCISE")) {
    markers.push("exercise");
  }

  if (actions.some((action) => action.type === "MEDICINE")) {
    markers.push("medicine");
  }

  return markers;
}

function getDayAriaLabel(day: Date, record?: DayRecord) {
  const eventLabels = getCalendarMarkers(record).map((marker) => {
    if (marker === "patch") {
      return "patch change";
    }

    if (marker === "optune") {
      return "Optune activity";
    }

    return marker === "exercise" ? "exercise" : "medicine";
  });
  const base = day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return eventLabels.length ? `${base}: ${eventLabels.join(", ")}` : base;
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
  const [editingAction, setEditingAction] = useState<DailyActionRecord | null>(null);
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartX = useRef<number | null>(null);
  const pullStartY = useRef<number | null>(null);
  const isPulling = useRef(false);
  const openSession = getOpenSession(records);

  const selectedDate = keyToDate(selectedKey);
  const selectedRecord = records[selectedKey] ?? emptyRecord();
  const didChangePatchesSelectedDay = Boolean(selectedRecord.patchChanged);
  const didExerciseSelectedDay = Boolean(selectedRecord.actions?.some((action) => action.type === "EXERCISE"));
  const didTakeMedicineSelectedDay = Boolean(selectedRecord.actions?.some((action) => action.type === "MEDICINE"));
  const weeks = useMemo(() => makeCalendarWeeks(viewDate), [viewDate]);
  const statsDate = scope === "month" || scope === "year" ? viewDate : selectedDate;
  const stats = summarize(records, statsDate, scope);
  const runningStats = summarizeRunning(records, statsDate, scope);
  const showRunningStats = scope === "week" || scope === "month" || scope === "year";
  const activitySessions = scope === "day" || scope === "week" ? getPeriodSessions(records, statsDate, scope) : [];
  const patchChanges = getPeriodPatchChanges(records, statsDate, scope);
  const periodActions = getPeriodActions(records, statsDate, scope);
  const exerciseCount = periodActions.filter((action) => action.type === "EXERCISE").length;
  const medicineCount = periodActions.filter((action) => action.type === "MEDICINE").length;
  const actionGroups = (["EXERCISE", "MEDICINE"] as const)
    .map((type) => ({
      type,
      label: actionLabels[type],
      dotClass: type === "EXERCISE" ? "exerciseDot" : "medicineDot",
      actions: periodActions.filter((action) => action.type === type)
    }))
    .filter((group) => group.actions.length > 0);

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

  function toggleDailyAction(type: DailyActionType) {
    const now = new Date();
    const occurredAt = makeActionOccurrenceIso(selectedKey, now);
    setScope("day");
    void runMutation(
      () => postRecords("/api/action", { type, occurredAt }),
      (current) => toggleDailyActionRecord(current, selectedKey, type, occurredAt)
    );
  }

  function editDailyAction(action: DailyActionRecord) {
    setError("");
    closeSessionEditor();
    setEditingAction(action);
    setActionDraft(makeActionDraft(action));
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
    closeActionEditor();
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

  function closeActionEditor() {
    setEditingAction(null);
    setActionDraft(null);
  }

  function updateActionDraft(field: keyof ActionDraft, value: string) {
    setActionDraft((draft) => (draft ? { ...draft, [field]: value } : draft));
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

  async function saveDailyAction() {
    if (!editingAction || !actionDraft) {
      return;
    }

    try {
      setError("");
      setIsSaving(true);
      setRecords(await requestRecords("/api/action", "PATCH", { id: editingAction.id, occurredAt: actionDraftToIso(actionDraft) }));
      closeActionEditor();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEditingDailyAction() {
    if (!editingAction) {
      return;
    }

    try {
      setError("");
      setIsSaving(true);
      setRecords(await requestRecords("/api/action", "DELETE", { id: editingAction.id }));
      closeActionEditor();
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
    if (!touch || window.scrollY > 0 || isSaving || editingSession || editingAction) {
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
        <ArrowClockwise aria-hidden="true" size={18} weight="bold" />
      </div>
      {isSaving ? <span className="saving">Saving</span> : null}

      {error ? <p className="error">{error}</p> : null}

      <section className="actions" aria-label="Actions">
        <button
          aria-label={openSession ? "Turn off Optune" : "Turn on Optune"}
          aria-pressed={Boolean(openSession)}
          className={`actionButton ${openSession ? "actionButtonPressed optuneActionActive" : ""}`}
          disabled={isSaving}
          onClick={toggleOptune}
        >
          <span aria-hidden="true">{openSession ? <Stop size={18} weight="fill" /> : <Play size={18} weight="fill" />}</span>
          <span>{openSession ? "Turn Optune off" : "Turn Optune on"}</span>
        </button>
        <button
          aria-label={didChangePatchesSelectedDay ? "Undo changed patches" : "Changed patches"}
          aria-pressed={didChangePatchesSelectedDay}
          className={`actionButton ${didChangePatchesSelectedDay ? "actionButtonPressed patchActionActive" : ""}`}
          disabled={isSaving}
          onClick={togglePatchChanged}
        >
          <span aria-hidden="true">
            <Bandaids size={18} weight="bold" />
          </span>
          <span>Changed Patches</span>
        </button>
        <button
          aria-label={didExerciseSelectedDay ? "Undo exercised" : "Exercised"}
          aria-pressed={didExerciseSelectedDay}
          className={`actionButton ${didExerciseSelectedDay ? "actionButtonPressed exerciseActionActive" : ""}`}
          disabled={isSaving}
          onClick={() => toggleDailyAction("EXERCISE")}
        >
          <span aria-hidden="true">
            <SneakerMove size={18} weight="bold" />
          </span>
          <span>Exercied</span>
        </button>
        <button
          aria-label={didTakeMedicineSelectedDay ? "Undo medicine" : "Took medicine"}
          aria-pressed={didTakeMedicineSelectedDay}
          className={`actionButton ${didTakeMedicineSelectedDay ? "actionButtonPressed medicineActionActive" : ""}`}
          disabled={isSaving}
          onClick={() => toggleDailyAction("MEDICINE")}
        >
          <span aria-hidden="true">
            <Pill size={18} weight="bold" />
          </span>
          <span>Took Meds</span>
        </button>
      </section>

      <section className="calendarPanel" aria-label="Calendar">
        <div className="monthBar">
          <button className="iconButton" aria-label="Previous month" onClick={() => setViewDate((date) => addMonths(date, -1))}>
            <CaretLeft aria-hidden="true" size={24} weight="bold" />
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
            <CaretRight aria-hidden="true" size={24} weight="bold" />
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
          const weekNumber = getWeekNumber(firstDay);
          return (
            <div className="weekRow" key={weekKey}>
              <button
                aria-label={`Show week ${weekNumber} statistics from ${formatShortDate(firstDay)}`}
                className={`weekRail ${scope === "week" && dateKey(startOfWeek(selectedDate)) === weekKey ? "weekRailActive" : ""}`}
                onClick={() => selectWeek(firstDay)}
              >
                {weekNumber}
              </button>
              {week.map((day) => {
                const key = dateKey(day);
                const record = records[key];
                const isSelected = selectedKey === key;
                const isToday = key === todayKey;
                const isCurrentMonth = day.getMonth() === viewDate.getMonth();
                const markers = getCalendarMarkers(record);

                return (
                  <button
                    aria-label={getDayAriaLabel(day, record)}
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
                    <span className="dayNumber">{day.getDate()}</span>
                    <span className="calendarMarkers" aria-hidden="true">
                      {markers
                        .filter((marker) => marker !== "patch" && marker !== "optune")
                        .map((marker) => (
                          <span className={`calendarDot ${marker}Dot`} key={marker} />
                        ))}
                    </span>
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
        </div>

        <div className="statsGrid">
          <div className="statBox">
            <strong>{formatDuration(stats.wearMs)}</strong>
            <span>Optune worn</span>
          </div>
          <div className="statBox totalStatBox">
            <strong>{Math.round(stats.percent)}%</strong>
            <span>Total</span>
          </div>
          {showRunningStats ? (
            <div className="statBox toDateStatBox">
              <strong>{Math.round(runningStats.percent)}%</strong>
              <span>To date</span>
            </div>
          ) : null}
          <div className="statBox">
            <strong>{stats.patchDays}</strong>
            <span>Patch changes</span>
          </div>
          <div className="statBox">
            <strong>{exerciseCount}</strong>
            <span>Exercise</span>
          </div>
          <div className="statBox">
            <strong>{medicineCount}</strong>
            <span>Medicine</span>
          </div>
        </div>

        <div className="detailBlock">
          {patchChanges.length ? (
            <div className="actionLog">
              <section className="actionGroup">
                <div className="actionGroupHeader">
                  <span className="calendarDot patchDot" aria-hidden="true" />
                  <strong>Patches</strong>
                  <span>{formatCount(patchChanges.length)}</span>
                </div>
                <div className="actionDates">
                  {patchChanges.map((change) => (
                    <div className="actionRow" key={change.key}>
                      <span className="actionDate">{formatPatchChangeDate(change)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <p className="emptyText">No patch changes recorded for this {scope}.</p>
          )}
        </div>

        <div className="detailBlock">
          {actionGroups.length ? (
            <div className="actionLog">
              {actionGroups.map((group) => (
                <section className="actionGroup" key={group.type}>
                  <div className="actionGroupHeader">
                    <span className={`calendarDot ${group.dotClass}`} aria-hidden="true" />
                    <strong>{group.label}</strong>
                    <span>{formatCount(group.actions.length)}</span>
                  </div>
                  <div className="actionDates">
                    {group.actions.map((action) => (
                      <ActivityRow
                        disabled={isSaving}
                        icon={<Clock size={18} weight="bold" />}
                        key={action.id}
                        onClick={() => editDailyAction(action)}
                      >
                        {formatActionDate(action)}
                      </ActivityRow>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="emptyText">No other actions recorded for this {scope}.</p>
          )}
        </div>

        {scope === "day" || scope === "week" ? (
          <div className="detailBlock">
            <h3>Optune activity</h3>
            {activitySessions.length ? (
              activitySessions.map((session) => (
                <ActivityRow icon={<Clock size={18} weight="bold" />} key={session.id} onClick={() => editSession(session)}>
                  {formatSessionRange(session, scope === "week")}
                </ActivityRow>
              ))
            ) : (
              <p className="emptyText">No Optune sessions recorded for this {scope}.</p>
            )}
          </div>
        ) : null}
      </section>

      <div className="refreshBar">
        <button className="refreshButton" disabled={isSaving} onClick={refreshRecords}>
          <ArrowClockwise aria-hidden="true" size={16} weight="bold" />
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
                <X aria-hidden="true" size={22} weight="bold" />
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

      {editingAction && actionDraft ? (
        <div className="modalOverlay" role="presentation">
          <section className="sessionEditor" aria-label={`Edit ${actionLabels[editingAction.type]}`} role="dialog" aria-modal="true">
            <div className="sessionEditorHeader">
              <div>
                <p className="statsLabel">{actionLabels[editingAction.type].toUpperCase()}</p>
                <h2>Edit time</h2>
              </div>
              <button className="iconButton" aria-label="Close editor" disabled={isSaving} onClick={closeActionEditor}>
                <X aria-hidden="true" size={22} weight="bold" />
              </button>
            </div>

            <div className="sessionFormGrid">
              <label>
                <span>Date</span>
                <input
                  disabled={isSaving}
                  type="date"
                  value={actionDraft.occurredDate}
                  onChange={(event) => updateActionDraft("occurredDate", event.target.value)}
                />
              </label>
              <label>
                <span>Time</span>
                <input
                  disabled={isSaving}
                  type="time"
                  value={actionDraft.occurredTime}
                  onChange={(event) => updateActionDraft("occurredTime", event.target.value)}
                />
              </label>
            </div>

            <div className="sessionEditorActions">
              <button className="deleteButton" disabled={isSaving} onClick={deleteEditingDailyAction}>
                Delete
              </button>
              <button className="secondaryButton" disabled={isSaving} onClick={closeActionEditor}>
                Cancel
              </button>
              <button className="saveButton" disabled={isSaving} onClick={saveDailyAction}>
                Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
