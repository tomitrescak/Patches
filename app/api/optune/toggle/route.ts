import { NextResponse } from "next/server";

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
    await prisma.optuneSession.create({
      data: {
        startAt: now
      }
    });
  }

  return NextResponse.json(await getRecords());
}
