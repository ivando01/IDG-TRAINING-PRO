import Sidebar from "@/components/Sidebar";

export default function ModulesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-24 lg:pb-0">{children}</div>
    </div>
  );
}
