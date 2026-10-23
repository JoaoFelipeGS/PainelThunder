import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Central de Vendas",
  description: "Painel pessoal para Mercado Livre e Shopee"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
