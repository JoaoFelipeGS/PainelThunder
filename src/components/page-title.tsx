export function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1><p className="mt-2 text-sm text-muted">{subtitle}</p></div>{action}</div>;
}
