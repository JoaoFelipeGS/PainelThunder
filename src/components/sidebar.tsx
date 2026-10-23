"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Package, Boxes, ShoppingCart, ChartNoAxesCombined, Settings, LogOut, Store, Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/app", label: "Visão geral", icon: LayoutDashboard },
  { href: "/app/produtos", label: "Produtos", icon: Package },
  { href: "/app/estoque", label: "Estoque", icon: Boxes },
  { href: "/app/anuncios", label: "Anúncios", icon: Megaphone },
  { href: "/app/pedidos", label: "Pedidos", icon: ShoppingCart },
  { href: "/app/faturamento", label: "Faturamento", icon: ChartNoAxesCombined },
  { href: "/app/configuracoes", label: "Configurações", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return <aside className="flex min-h-screen w-full flex-col border-r border-line bg-panel md:sticky md:top-0 md:h-screen md:w-64">
    <div className="flex h-[76px] items-center gap-3 border-b border-line px-6">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent"><Store size={21}/></div>
      <div><p className="font-semibold tracking-tight">Central de Vendas</p><p className="text-xs text-muted">Painel multicanal</p></div>
    </div>
    <nav className="flex-1 space-y-1 p-3">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/app" ? pathname === href : pathname.startsWith(href);
        return <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${active ? "bg-accent/15 font-medium text-indigo-200" : "text-muted hover:bg-white/[.04] hover:text-white"}`}>
          <Icon size={18}/>{label}
        </Link>;
      })}
    </nav>
    <div className="border-t border-line p-3">
      <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-muted hover:bg-white/[.04] hover:text-white"><LogOut size={18}/> Sair da conta</button>
    </div>
  </aside>;
}
