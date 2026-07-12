import { describe, expect, it } from "vitest";

import type { Records } from "@/lib/records";
import { getPeriod, summarize, summarizeRunning } from "@/lib/utility";

const DAY_MS = 24 * 60 * 60 * 1000;

function localDate(year: number, month: number, day: number, hour = 0) {
  return new Date(year, month - 1, day, hour);
}

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

function session(id: string, start: Date, end: Date) {
  return {
    id,
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function expectPercent(actual: number, expected: number) {
  expect(actual).toBeCloseTo(expected, 6);
}

function julyRecords(): Records {
  return {
    "2026-07-09": { sessions: [] },
    "2026-07-10": {
      sessions: [session("july-10-92-percent", localDate(2026, 7, 10), addMs(localDate(2026, 7, 10), 0.92 * DAY_MS))]
    },
    "2026-07-11": {
      sessions: [session("july-11-54-percent", localDate(2026, 7, 11), addMs(localDate(2026, 7, 11), 0.54 * DAY_MS))]
    }
  };
}

describe("summarize utility calculations", () => {
  it("starts weeks on Monday", () => {
    const period = getPeriod(localDate(2026, 7, 12), "week");

    expect(period.start).toEqual(localDate(2026, 7, 6));
    expect(period.end).toEqual(localDate(2026, 7, 13));
  });

  it("returns 0 for a week before the first recorded day", () => {
    const records: Records = {
      "2026-03-03": { sessions: [] }
    };

    const stats = summarize(records, localDate(2026, 2, 25), "week");

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });

  it("excludes the first recorded day from the containing weekly denominator", () => {
    const records: Records = {
      "2026-03-03": { sessions: [] },
      "2026-03-04": {
        sessions: [session("full-valid-week-tail", localDate(2026, 3, 4), localDate(2026, 3, 9))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 3), "week");

    expect(stats.wearMs).toBe(5 * DAY_MS);
    expect(stats.sessionCount).toBe(1);
    expectPercent(stats.percent, 100);
  });

  it("clips weekly wear that starts on the first recorded day", () => {
    const records: Records = {
      "2026-03-03": {
        sessions: [session("starts-on-first-record", localDate(2026, 3, 3), localDate(2026, 3, 9))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 3), "week");

    expect(stats.wearMs).toBe(5 * DAY_MS);
    expect(stats.sessionCount).toBe(1);
    expectPercent(stats.percent, 100);
  });

  it("does not count a session that only covers the first recorded day in weekly utility", () => {
    const records: Records = {
      "2026-03-03": {
        sessions: [session("first-day-only", localDate(2026, 3, 3), localDate(2026, 3, 4))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 3), "week");

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });

  it("returns 0 when the first valid day would be after the selected week ends", () => {
    const records: Records = {
      "2026-03-08": {
        sessions: [session("last-day-of-week", localDate(2026, 3, 8), localDate(2026, 3, 9))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 8), "week");

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });

  it("uses the full denominator for weeks after the first valid day, so missing days reduce utility", () => {
    const records: Records = {
      "2026-03-03": { sessions: [] },
      "2026-03-09": {
        sessions: [session("six-of-seven-days", localDate(2026, 3, 9), localDate(2026, 3, 15))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 9), "week");

    expect(stats.wearMs).toBe(6 * DAY_MS);
    expect(stats.sessionCount).toBe(1);
    expectPercent(stats.percent, (6 / 7) * 100);
  });

  it("averages the first valid July week across the days from July 10 through Sunday", () => {
    const stats = summarize(julyRecords(), localDate(2026, 7, 10), "week");

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, (92 + 54) / 3);
  });

  it("returns 0 for a July week after the recorded sessions when those missing valid days reduce utility", () => {
    const stats = summarize(julyRecords(), localDate(2026, 7, 13), "week");

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });

  it("excludes the first recorded day from yearly utility", () => {
    const records: Records = {
      "2026-03-03": { sessions: [] },
      "2026-03-04": {
        sessions: [session("full-valid-year-tail", localDate(2026, 3, 4), localDate(2027, 1, 1))]
      }
    };

    const stats = summarize(records, localDate(2026, 7, 1), "year");

    expect(stats.wearMs).toBe(localDate(2027, 1, 1).getTime() - localDate(2026, 3, 4).getTime());
    expect(stats.sessionCount).toBe(1);
    expectPercent(stats.percent, 100);
  });

  it("does not let the first recorded day contribute to yearly wear", () => {
    const records: Records = {
      "2026-03-03": {
        sessions: [session("first-record-year-day", localDate(2026, 3, 3), localDate(2026, 3, 4))]
      }
    };

    const stats = summarize(records, localDate(2026, 7, 1), "year");

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });

  it("averages July live-style wear across the valid remainder of the year", () => {
    const stats = summarize(julyRecords(), localDate(2026, 7, 12), "year");
    const validYearDays = (localDate(2027, 1, 1).getTime() - localDate(2026, 7, 10).getTime()) / DAY_MS;

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, (92 + 54) / validYearDays);
  });

  it("keeps day utility based on the selected day instead of excluding the first record", () => {
    const records: Records = {
      "2026-03-03": {
        sessions: [session("first-day", localDate(2026, 3, 3), localDate(2026, 3, 4))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 3), "day");

    expect(stats.wearMs).toBe(DAY_MS);
    expect(stats.sessionCount).toBe(1);
    expectPercent(stats.percent, 100);
  });

  it("excludes the first recorded day from monthly utility", () => {
    const records: Records = {
      "2026-03-03": { sessions: [] },
      "2026-03-04": {
        sessions: [session("full-valid-month-tail", localDate(2026, 3, 4), localDate(2026, 4, 1))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 12), "month");

    expect(stats.wearMs).toBe(localDate(2026, 4, 1).getTime() - localDate(2026, 3, 4).getTime());
    expect(stats.sessionCount).toBe(1);
    expectPercent(stats.percent, 100);
  });

  it("does not let the first recorded day contribute to monthly wear", () => {
    const records: Records = {
      "2026-03-03": {
        sessions: [session("one-day-in-month", localDate(2026, 3, 3), localDate(2026, 3, 4))]
      }
    };

    const stats = summarize(records, localDate(2026, 3, 12), "month");

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });

  it("averages July utility across valid days from the day after the first record", () => {
    const stats = summarize(julyRecords(), localDate(2026, 7, 12), "month");

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, ((92 + 54) / 22));
  });

  it("calculates running July monthly utility only through today", () => {
    const stats = summarizeRunning(julyRecords(), localDate(2026, 7, 12), "month", localDate(2026, 7, 12));

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, (92 + 54) / 3);
  });

  it("calculates running yearly utility only through today", () => {
    const stats = summarizeRunning(julyRecords(), localDate(2026, 7, 12), "year", localDate(2026, 7, 12));

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, (92 + 54) / 3);
  });

  it("keeps a completed week running utility the same as its final weekly utility", () => {
    const stats = summarizeRunning(julyRecords(), localDate(2026, 7, 10), "week", localDate(2026, 7, 12));

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, (92 + 54) / 3);
  });

  it("uses only elapsed valid days for the current running week", () => {
    const stats = summarizeRunning(julyRecords(), localDate(2026, 7, 12), "week", localDate(2026, 7, 12));

    expect(stats.wearMs).toBe((0.92 + 0.54) * DAY_MS);
    expect(stats.sessionCount).toBe(2);
    expectPercent(stats.percent, (92 + 54) / 3);
  });

  it("returns 0 running utility for a future week", () => {
    const stats = summarizeRunning(julyRecords(), localDate(2026, 7, 20), "week", localDate(2026, 7, 12));

    expect(stats.wearMs).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expectPercent(stats.percent, 0);
  });
});
