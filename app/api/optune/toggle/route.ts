import { NextResponse } from "next/server";

import { dateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { getRecords } from "@/lib/records";

export async function POST() {
  const now = new Date();
  const openSession = await prisma.optuneSession.findFirst({
    where: {
      endAt: null
    },
    orderBy: {
      startAt: "desc"
    }
  });

  if (openSession) {
    await prisma.optuneSession.update({
      where: {
        id: openSession.id
      },
      data: {
        endAt: now
      }
    });
  } else {
    const day = await prisma.patchDay.upsert({
      where: {
        dateKey: dateKey(now)
      },
      create: {
        dateKey: dateKey(now)
      },
      update: {}
    });

    await prisma.optuneSession.create({
      data: {
        dayId: day.id,
        startAt: now
      }
    });
  }

  return NextResponse.json(await getRecords());
}
