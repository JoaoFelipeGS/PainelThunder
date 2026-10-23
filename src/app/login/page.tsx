import { LoginForm } from "@/components/login-form";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ setup?: string; next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm setup={Boolean(params.setup)} next={params.next} />;
}
