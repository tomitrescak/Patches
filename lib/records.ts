import { prisma } from "@/lib/prisma";
import { dateKey } from "@/lib/dates";

export type OptuneSessionRecord = {
  id: string;
  start: string;
  end?: string;
};

export type DayRecord = {
  patchChanged?: boolean;
  patchChangedAt?: string;
  sessions: OptuneSessionRecord[];
};

export type Records = Record<string, DayRecord>;

function emptyRecord(): DayRecord {
  return { sessions: [] };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addSessionToTouchedDays(records: Records, session: { id: string; startAt: Date; endAt: Date | null }) {
  const { id, startAt, endAt } = session;
  const sessionEnd = endAt ?? new Date();
  let cursor = startOfDay(startAt);

  while (cursor < sessionEnd) {
    const dayStart = startOfDay(cursor);
    const dayHasOverlap = startAt < endOfDay(dayStart) && sessionEnd > dayStart;

    if (dayHasOverlap) {
      const key = dateKey(dayStart);
      const record = records[key] ?? emptyRecord();
      records[key] = {
        ...record,
        sessions: [
          ...record.sessions,
          {
            id,
            start: startAt.toISOString(),
            end: endAt?.toISOString()
          }
        ]
      };
    }

    cursor = addDays(cursor, 1);
  }
}

export async function getRecords(): Promise<Records> {
  const [days, sessions] = await Promise.all([
    prisma.patchDay.findMany({
      orderBy: {
        dateKey: "asc"
      }
    }),
    prisma.optuneSession.findMany({
      orderBy: {
        startAt: "asc"
      }
    })
  ]);

  const records: Records = {};

  days.forEach((day) => {
    records[day.dateKey] = {
      patchChanged: day.patchChanged,
      patchChangedAt: day.patchChanged ? day.updatedAt.toISOString() : undefined,
      sessions: []
    };
  });

  sessions.forEach((session) => {
    addSessionToTouchedDays(records, session);
  });

  return records;
}
