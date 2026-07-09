import { NextResponse } from "next/server";

import { isDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { getRecords } from "@/lib/records";

export async function POST(request: Request) {
  const body = (await request.json()) as { dateKey?: unknown };

  if (!isDateKey(body.dateKey)) {
    return NextResponse.json({ error: "A valid dateKey is required." }, { status: 400 });
  }

  const day = await prisma.patchDay.upsert({
    where: {
      dateKey: body.dateKey
    },
    create: {
      dateKey: body.dateKey,
      patchChanged: true
    },
    update: {}
  });

  if (day.patchChanged) {
    await prisma.patchDay.delete({
      where: {
        id: day.id
      }
    });
  } else {
    await prisma.patchDay.update({
      where: {
        id: day.id
      },
      data: {
        patchChanged: true
      }
    });
  }

  return NextResponse.json(await getRecords());
}
