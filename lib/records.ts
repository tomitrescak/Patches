import { prisma } from "@/lib/prisma";

export type OptuneSessionRecord = {
  start: string;
  end?: string;
};

export type DayRecord = {
  patchChanged?: boolean;
  sessions: OptuneSessionRecord[];
};

export type Records = Record<string, DayRecord>;

export async function getRecords(): Promise<Records> {
  const days = await prisma.patchDay.findMany({
    include: {
      sessions: {
        orderBy: {
          startAt: "asc"
        }
      }
    },
    orderBy: {
      dateKey: "asc"
    }
  });

  return Object.fromEntries(
    days.map((day) => [
      day.dateKey,
      {
        patchChanged: day.patchChanged,
        sessions: day.sessions.map((session) => ({
          start: session.startAt.toISOString(),
          end: session.endAt?.toISOString()
        }))
      }
    ])
  );
}
