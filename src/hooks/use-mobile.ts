import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // 初始状态设为 false，确保服务端和客户端一致
  const [isMobile, setIsMobile] = React.useState<boolean>(false);
  const [hasMounted, setHasMounted] = React.useState(false);

  React.useEffect(() => {
    setHasMounted(true);
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // 在服务端渲染和首次客户端渲染时返回 false，避免 hydration mismatch
  if (!hasMounted) {
    return false;
  }

  return isMobile;
}
