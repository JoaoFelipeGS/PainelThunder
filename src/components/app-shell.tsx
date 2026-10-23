import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen md:flex"><Sidebar/><main className="min-w-0 flex-1"><div className="mx-auto max-w-7xl p-5 md:p-9">{children}</div></main></div>;
}
