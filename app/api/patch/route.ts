import { NextResponse } from "next/server";

import { isDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { getRecords } from "@/lib/records";

export async function POST(request: Request) {
  const body = (await request.json()) as { dateKey?: unknown };

  if (!isDateKey(body.dateKey)) {
    return NextResponse.json({ error: "A valid dateKey is required." }, { status: 400 });
  }

  const existingDay = await prisma.patchDay.findUnique({
    where: {
      dateKey: body.dateKey
    }
  });

  if (existingDay?.patchChanged) {
    await prisma.patchDay.delete({
      where: {
        id: existingDay.id
      }
    });
  } else {
    await prisma.patchDay.upsert({
      where: {
        dateKey: body.dateKey
      },
      create: {
        dateKey: body.dateKey,
        patchChanged: true
      },
      update: {
        patchChanged: true
      }
    });
  }

  return NextResponse.json(await getRecords());
}
