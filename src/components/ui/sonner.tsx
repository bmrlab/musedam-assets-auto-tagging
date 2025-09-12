"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      expand={false}
      richColors={true}
      closeButton={false}
      duration={3000}
      offset={8}
      style={
        {
          "--unified-bg": "var(--ant-basic-0)",
          "--unified-text": "var(--ant-basic-6)",
          "--unified-shadow": "0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
