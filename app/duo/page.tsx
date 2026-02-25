import DuoClient from "./DuoClient";

export const dynamic = "force-dynamic";

export default function DuoPage() {
  return <DuoClient groupKey="duo" />;
}