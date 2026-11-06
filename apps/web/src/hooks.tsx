import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { AppConfig } from "./api";

const ConfigContext = createContext<AppConfig>({ demoMode: false, devAuth: false, modes: { rails: "fake", brain: "fake", trust: "fake" } });
export const ConfigProvider = ({ value, children }: { value: AppConfig; children: ReactNode }) => (
  <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
);
export const useConfig = () => useContext(ConfigContext);

/** Calls fn now and then every ms while enabled. fn is kept fresh without restarting the timer. */
export function usePoll(fn: () => void | Promise<void>, ms: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    void ref.current();
    const t = setInterval(() => void ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}
