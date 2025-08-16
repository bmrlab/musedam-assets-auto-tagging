import { getCsrfToken, getSession } from "next-auth/react";

export async function signInWithEmail({ email, password }: { email: string; password: string }) {
  let csrfToken: string;
  try {
    csrfToken = (await getCsrfToken()) ?? "";
  } catch {
    throw new Error("Failed to retrieve CSRF token");
  }

  const res = await fetch("/api/auth/callback/credentials", {
    method: "post",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      redirect: "false",
      json: "true",
    }),
  });

  const data = await res.json();

  const error = new URL(data.url).searchParams.get("error");

  if (res.ok) {
    try {
      await getSession({ event: "storage" });
    } catch {
      throw new Error("Failed to retrieve session");
    }
  }

  if (error) {
    throw new Error(error);
  }
}
