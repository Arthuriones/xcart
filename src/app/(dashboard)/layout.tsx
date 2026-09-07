import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SidebarData, SidebarSkeleton } from "@/components/layout/sidebar-data";
import { TopNav } from "@/components/layout/top-nav";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { userHasAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Trava de acesso: sem acesso (free nao liberado) cai na pagina /no-access.
  // So bloqueia quando ACCESS_CONTROL_ENABLED=true; senao userHasAccess()=true.
  const user = await getCurrentUser();
  if (user && !(await userHasAccess(user.id))) {
    redirect("/no-access");
  }


  return (
    <div className="min-h-screen font-sans bg-background">
      <TopNav />
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarData />
      </Suspense>
      <main className="min-h-screen pb-16 pt-[52px] md:pb-0 md:pl-[216px]">
        <div className="w-full max-w-[1240px] px-4 pb-[72px] pt-[22px] sm:px-6">
          {children}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
