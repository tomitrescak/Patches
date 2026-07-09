import PatchTracker from "@/components/PatchTracker";
import { getRecords } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function Home() {
  const records = await getRecords();

  return <PatchTracker initialRecords={records} />;
}
