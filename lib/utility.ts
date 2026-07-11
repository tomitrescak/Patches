import { keyToDate } from "@/lib/dates";
import type { OptuneSessionRecord, Records } from "@/lib/records";

export type Scope = "day" | "week" | "month" | "year";

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

export function getPeriod(date: Date, scope: Scope) {
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

export function getOverlapMs(session: OptuneSessionRecord, periodStart: Date, periodEnd: Date) {
  const start = new Date(session.start).getTime();
  const end = session.end ? new Date(session.end).getTime() : Date.now();
  const overlapStart = Math.max(start, periodStart.getTime());
  const overlapEnd = Math.min(end, periodEnd.getTime());
  return Math.max(0, overlapEnd - overlapStart);
}

function getFirstRecordDate(records: Records) {
  return Object.keys(records).reduce<Date | null>((earliest, key) => {
    const recordDate = keyToDate(key);
    return !earliest || recordDate < earliest ? recordDate : earliest;
  }, null);
}

function getUtilityStart(records: Records, periodStart: Date, periodEnd: Date, scope: Scope) {
  if (scope === "day") {
    return periodStart;
  }

  const firstRecordDate = getFirstRecordDate(records);
  if (!firstRecordDate || firstRecordDate >= periodEnd) {
    return null;
  }

  const firstValidDate = addDays(firstRecordDate, 1);
  if (firstValidDate >= periodEnd) {
    return null;
  }

  return firstValidDate > periodStart ? firstValidDate : periodStart;
}

export function summarize(records: Records, date: Date, scope: Scope) {
  const { start, end } = getPeriod(date, scope);
  const utilityStart = getUtilityStart(records, start, end, scope);
  let wearMs = 0;
  let patchDays = 0;
  let sessionCount = 0;
  const countedSessions = new Set<string>();

  Object.entries(records).forEach(([key, record]) => {
    const recordDate = keyToDate(key);
    if (record.patchChanged && recordDate >= start && recordDate < end) {
      patchDays += 1;
    }

    record.sessions.forEach((session) => {
      if (countedSessions.has(session.id)) {
        return;
      }

      const overlap = utilityStart ? getOverlapMs(session, utilityStart, end) : 0;
      if (overlap > 0) {
        countedSessions.add(session.id);
        wearMs += overlap;
        sessionCount += 1;
      }
    });
  });

  const periodMs = utilityStart ? end.getTime() - utilityStart.getTime() : 0;
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
