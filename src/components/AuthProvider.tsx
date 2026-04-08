"use client";

import * as React from "react";
import {
  SessionProvider as NextAuthSessionProvider,
  type SessionProviderProps,
} from "next-auth/react";

const SessionProvider = NextAuthSessionProvider as unknown as React.ComponentType<SessionProviderProps>;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
