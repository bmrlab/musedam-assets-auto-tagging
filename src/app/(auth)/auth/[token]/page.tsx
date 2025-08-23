import { TokenAuthPageClient } from "./TokenAuthPageClient";

export default async function TokenAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    callbackUrl?: string;
  }>;
}) {
  const { token } = await params;
  const { callbackUrl } = await searchParams;
  return <TokenAuthPageClient token={token} callbackUrl={callbackUrl ?? "/"} />;
}
