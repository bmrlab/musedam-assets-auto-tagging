"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { signInWithEmail } from "./client";

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isWechat, setIsWechat] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsWechat(window.navigator.userAgent.toLowerCase().includes("micromessenger"));
    }
  }, [searchParams, router, callbackUrl]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      // const result = await signIn("credentials", {
      //   email,
      //   password,
      //   redirect: false,
      // });
      await signInWithEmail({
        email,
        password,
      });
      // Redirect to callback page to check onboarding status
      window.location.replace(callbackUrl);
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg === "EMAIL_NOT_VERIFIED") {
        router.push(`/auth/verify?email=${email}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else if (["INVALID_CREDENTIALS", "USER_NOT_FOUND", "INVALID_PASSWORD"].includes(errMsg)) {
        setError("Invalid email or password");
      } else {
        setError(errMsg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center p-4">
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Login</CardTitle>
          <CardDescription className="text-center">Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}
            <div>
              <Input
                id="email"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
                required
              />
            </div>
            <div className="relative">
              <Input
                id="password"
                placeholder="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                aria-label={showPassword ? "Hide Password" : "Show Password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <Button
              variant="default"
              className="w-full h-10 font-medium"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
