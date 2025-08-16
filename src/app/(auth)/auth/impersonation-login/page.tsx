"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2Icon } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

export default function ImpersonationLoginPage() {
  return (
    <Suspense>
      <ImpersonationLogin />
    </Suspense>
  );
}

function ImpersonationLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "expired">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const callbackUrl = searchParams.get("callbackUrl") || "/";

    if (!token) {
      setStatus("error");
      setError("No login token provided");
      return;
    }

    // Auto-login the user using NextAuth
    const performLogin = async () => {
      try {
        const result = await signIn("impersonation-login", {
          token,
          redirect: false,
        });

        if (result?.ok && !result?.error) {
          setStatus("success");
          // Redirect to callback URL after a short delay
          setTimeout(() => {
            window.location.replace(callbackUrl);
          }, 1500);
        } else {
          setStatus("error");
          if (result?.error === "INVALID_TOKEN") {
            setError("Login token is invalid or expired");
          } else if (result?.error === "USER_NOT_FOUND") {
            setError("User account not found");
          } else if (result?.error === "EMAIL_NOT_VERIFIED") {
            setError("User email is not verified");
          } else {
            setError("Login failed");
          }
        }
      } catch (err) {
        console.log(err);
        setStatus("error");
        setError("An error occurred during login");
      }
    };

    performLogin();
  }, [searchParams]);

  const handleManualLogin = () => {
    const callbackUrl = searchParams.get("callbackUrl") || "/";
    router.push(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  };

  return (
    <div className="flex items-center justify-center p-4">
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Impersonation Login</CardTitle>
          <CardDescription className="text-center">
            {status === "loading" && "Verifying your login token..."}
            {status === "success" && "Login successful! Redirecting..."}
            {status === "error" && "Login failed"}
            {status === "expired" && "Token expired"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && (
            <div className="flex justify-center">
              <Loader2Icon className="size-8 animate-spin mx-auto mb-4" />
            </div>
          )}

          {status === "success" && (
            <div className="text-center space-y-4">
              <div className="text-green-600 text-lg">✓ Successfully logged in!</div>
              <div className="text-sm text-gray-600">You will be redirected shortly...</div>
            </div>
          )}

          {(status === "error" || status === "expired") && (
            <div className="space-y-4">
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800">
                {error}
              </div>
              <Button onClick={handleManualLogin} className="w-full">
                Go to Login Page
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
