"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function TokenAuthPageClient({
  token,
  callbackUrl,
}: {
  token: string;
  callbackUrl: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    signIn("token-login", {
      token,
      callbackUrl,
    })
      .then((result) => {
        if (result?.ok && !result?.error) {
          router.replace(callbackUrl);
        } else {
          setError(result?.error ?? "Auth failed");
        }
        setLoading(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, callbackUrl, router]);

  if (loading) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
            <CardDescription>Please wait while we authenticate you.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">Go to Home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }
}
