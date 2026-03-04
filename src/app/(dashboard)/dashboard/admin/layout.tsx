import { notFound } from "next/navigation";
import { getCurrentMembership } from "@/lib/auth-utils";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const membership = await getCurrentMembership();
  if (
    !membership ||
    (membership.role !== "admin" && membership.role !== "platform_admin")
  ) {
    notFound();
  }

  return <>{children}</>;
}
