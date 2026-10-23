import { PageTitle } from "@/components/page-title";
import { MarketplaceConnections, type MarketplaceConnection } from "@/components/marketplace-connections";
import { isMarketplaceConfigured } from "@/lib/marketplaces/shared/config";
import { createServerSupabase } from "@/lib/supabase/server";

type SettingsSearchParams = {
  integration?: string;
  result?: string;
};

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const supabase = await createServerSupabase();
  const [{ data: { user } }, { data, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("marketplace_connections")
      .select("id,user_id,platform,external_account_id,account_label,status,expires_at,last_synced_at,last_error")
      .order("created_at", { ascending: false })
  ]);
  const params = await searchParams;

  return (
    <>
      <PageTitle title="Configurações" subtitle="Conta e conexões oficiais dos marketplaces." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">Sua conta</h2>
          <p className="mt-2 text-sm text-muted">Usuário autenticado</p>
          <p className="mt-1 break-all text-sm">{user?.email ?? "—"}</p>
          <p className="mt-4 text-xs leading-5 text-muted">
            A conta deve ser criada em Supabase → Authentication → Users. Mantenha o cadastro público desativado se somente você usará o sistema.
          </p>
        </section>
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">Segurança das credenciais</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Os tokens OAuth são cifrados no servidor e não são selecionáveis pelo navegador. As chaves privadas nunca devem usar prefixo `NEXT_PUBLIC_`.
          </p>
        </section>
        <MarketplaceConnections
          connections={(data ?? []) as MarketplaceConnection[]}
          configured={{
            mercado_livre: isMarketplaceConfigured("mercado_livre"),
            shopee: isMarketplaceConfigured("shopee")
          }}
          migrationError={Boolean(error)}
          resultPlatform={params.integration}
          result={params.result}
        />
      </div>
    </>
  );
}
