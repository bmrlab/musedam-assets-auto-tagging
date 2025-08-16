"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { signUp } from "./actions";

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setIsLoading(true);
    try {
      setError("");
      const result = await signUp({
        email,
        password,
      });
      if (!result.success) {
        throw result;
      }
      // Sign in automatically after successful registration
      // await signIn("credentials", {
      //   email,
      //   password,
      //   callbackUrl: "/",
      // });
      router.push("/auth/signin");
    } catch (error) {
      setError((error as Error).message);
    }
    setIsLoading(false);
  };

  return (
    <div className="flex items-center justify-center p-4">
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Sign Up</CardTitle>
          <CardDescription className="text-center">Create a new account</CardDescription>
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
            <div className="space-y-2">
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
            </div>
            <div className="relative">
              <Input
                id="confirmPassword"
                placeholder="Confirm Password"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                aria-label={showConfirmPassword ? "Hide Confirm Password" : "Show Confirm Password"}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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
