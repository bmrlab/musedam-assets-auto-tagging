import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";
// import { SessionProvider } from "next-auth/react";  // SessionProvider 只能在 client 使用，需要 创建一个新文件 AuthProvider 然后 use client;
import { AuthProvider } from "@/components/AuthProvider";
import { Embed } from "@/embed/Embed";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MuseDAM AI 自动打标",
  description: "MuseDAM AI 自动打标",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            {children}
            <Toaster richColors={true} />
          </ThemeProvider>
        </AuthProvider>
        <Suspense fallback={null}>
          <Embed />
        </Suspense>
      </body>
    </html>
  );
}
