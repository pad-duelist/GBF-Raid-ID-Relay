// app/g/[groupId]/page.tsx
export const dynamic = "force-dynamic";

import GroupPageClient from "./GroupPageClient";

export default function GroupPage({ params }: { params: { groupId: string } }) {
  return <GroupPageClient groupId={params.groupId} />;
}
