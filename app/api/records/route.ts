import { NextResponse } from "next/server";

import { getRecords } from "@/lib/records";

export async function GET() {
  return NextResponse.json(await getRecords());
}
