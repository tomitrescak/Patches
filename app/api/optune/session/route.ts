import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRecords } from "@/lib/records";

function parseRequiredDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return parseRequiredDate(value);
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: unknown; start?: unknown; end?: unknown };

  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "A session id is required." }, { status: 400 });
  }

  const startAt = parseRequiredDate(body.start);
  const endAt = parseOptionalDate(body.end);

  if (!startAt) {
    return NextResponse.json({ error: "A valid start time is required." }, { status: 400 });
  }

  if (body.end && !endAt) {
    return NextResponse.json({ error: "A valid end time is required." }, { status: 400 });
  }

  if (endAt && endAt <= startAt) {
    return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  }

  if (!endAt) {
    const otherOpenSession = await prisma.optuneSession.findFirst({
      where: {
        endAt: null,
        NOT: {
          id: body.id
        }
      }
    });

    if (otherOpenSession) {
      return NextResponse.json({ error: "Another Optune session is already open." }, { status: 400 });
    }
  }

  await prisma.optuneSession.update({
    where: {
      id: body.id
    },
    data: {
      startAt,
      endAt
    }
  });

  return NextResponse.json(await getRecords());
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { id?: unknown };

  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "A session id is required." }, { status: 400 });
  }

  await prisma.optuneSession.delete({
    where: {
      id: body.id
    }
  });

  return NextResponse.json(await getRecords());
}
