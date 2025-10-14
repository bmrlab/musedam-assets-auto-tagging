import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
// import { SessionProvider } from "next-auth/react";  // SessionProvider 只能在 client 使用，需要 创建一个新文件 AuthProvider 然后 use client;
import { AuthProvider } from "@/components/AuthProvider";
import { Embed } from "@/embed/Embed";
import { NextIntlClientProvider } from "next-intl";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { PageLoadingFallback } from "@/components/PageLoadingFallback";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthProvider>
            <NextIntlClientProvider >
              <Suspense
                fallback={
                  <div className="h-dvh w-dvw flex flex-col items-stretch justify-start bg-background">
                    <PageLoadingFallback />
                  </div>
                }
              >
                {children}
              </Suspense>
              <Toaster richColors={true} offset={20} />
            </NextIntlClientProvider>
          </AuthProvider>
        </ThemeProvider>
        <Suspense fallback={null}>
          <Embed locale={locale} />
        </Suspense>
      </body>
    </html>
  );
}
