import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { AppFrame } from "@/components/AppFrame";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <AppFrame userEmail={user.email}>{children}</AppFrame>;
}
