import { NextResponse } from "next/server";

import type { DailyActionType } from "@/lib/records";
import { prisma } from "@/lib/prisma";
import { getRecords } from "@/lib/records";

const actionTypes = new Set<DailyActionType>(["EXERCISE", "MEDICINE"]);

function parseActionType(value: unknown): DailyActionType | null {
  return typeof value === "string" && actionTypes.has(value as DailyActionType) ? (value as DailyActionType) : null;
}

function parseRequiredDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

export async function POST(request: Request) {
  const body = (await request.json()) as { type?: unknown; occurredAt?: unknown };
  const type = parseActionType(body.type);
  const occurredAt = parseRequiredDate(body.occurredAt);

  if (!type) {
    return NextResponse.json({ error: "A valid action type is required." }, { status: 400 });
  }

  if (!occurredAt) {
    return NextResponse.json({ error: "A valid action time is required." }, { status: 400 });
  }

  const existingActions = await prisma.dailyAction.findMany({
    select: {
      id: true
    },
    where: {
      type,
      occurredAt: {
        gte: startOfDay(occurredAt),
        lt: endOfDay(occurredAt)
      }
    }
  });

  if (existingActions.length) {
    await prisma.dailyAction.deleteMany({
      where: {
        id: {
          in: existingActions.map((action) => action.id)
        }
      }
    });
  } else {
    await prisma.dailyAction.create({
      data: {
        type,
        occurredAt
      }
    });
  }

  return NextResponse.json(await getRecords());
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { id?: unknown };

  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "An action id is required." }, { status: 400 });
  }

  await prisma.dailyAction.delete({
    where: {
      id: body.id
    }
  });

  return NextResponse.json(await getRecords());
}
