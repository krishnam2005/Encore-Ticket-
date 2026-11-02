import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { ApiProvider } from "@/lib/api-context";

// One provider for all console pages, so activity, holds and events survive client-side navigation.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ApiProvider>
      <Shell>{children}</Shell>
    </ApiProvider>
  );
}
