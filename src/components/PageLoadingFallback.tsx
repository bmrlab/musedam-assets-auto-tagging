"use client";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";

export function PageLoadingFallback() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simulate progress: start fast, then slow down, but never complete.
    const timer1 = setTimeout(() => setProgress(25), 200); // Fast start
    const timer2 = setTimeout(() => setProgress(65), 700); // Slowing down
    const timer3 = setTimeout(() => setProgress(90), 2000); // Almost there...
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  return (
    <>
      <div className="h-1">
        <Progress value={progress} className="h-full w-full" />
      </div>
      {/*
        This div acts as a placeholder to prevent the layout from collapsing or shifting
        when the content is suspended. It mimics the structure of a typical page content area.
      */}
      <div className="flex-1" />
    </>
  );
}
