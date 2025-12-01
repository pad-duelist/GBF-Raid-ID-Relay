// app/page.tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  // ルートに来たら /login に即リダイレクト
  redirect("/login");
}
