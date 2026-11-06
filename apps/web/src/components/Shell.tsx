import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BuiltOn } from "./Brand";
import { Arrow, btn } from "./ui";

/** App pages in flow order: authorize, research, verify, revisit. */
export const NAV = [
  { key: "mandate", label: "Mandate" }, { key: "research", label: "Research" },
  { key: "ledger", label: "Ledger" }, { key: "history", label: "History" },
] as const;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70";

/** A boom barrier on a gold tile. The arm lifts when its parent link is hovered. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="tb-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe3b0" />
          <stop offset="1" stopColor="#df9f2f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#tb-mark)" />
      <path d="M11 8.5v15M8 23.5h6" fill="none" stroke="#0b0b0c" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M11 12h13" fill="none" stroke="#0b0b0c" strokeWidth="2.6" strokeLinecap="round"
        className="origin-[11px_12px] transition-transform duration-500 ease-out-expo [transform-box:view-box] group-hover:-rotate-[28deg]" />
    </svg>
  );
}

export function SiteHeader({ page, onSignOut }: { page: string; onSignOut?: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  // slide: animate position only when moving between two items, not when first appearing or resizing.
  const [pill, setPill] = useState({ left: 0, width: 0, on: false, slide: false });

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => setOpen(false), [page]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      // Slide only when the active item moved; a resize snaps.
      setPill((p) => (el ? { left: el.offsetLeft, width: el.offsetWidth, on: true, slide: p.on && p.left !== el.offsetLeft } : { ...p, on: false, slide: false }));
    };
    measure();
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure); // web font swap changes link widths
    return () => window.removeEventListener("resize", measure);
  }, [page]);

  const solid = scrolled || open;
  return (
    <header className={`sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300 ${solid ? "border-white/[0.06] bg-ink/75 backdrop-blur-xl" : "border-transparent"}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#/" aria-label="Kakashi home" className={`group flex items-center gap-2.5 rounded-lg ${focusRing}`}>
          <LogoMark />
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-tight text-zinc-50">Kakashi</span>
            <span lang="ja" className="mt-0.5 text-[10px] tracking-[0.2em] text-zinc-400">カカシ</span>
          </span>
        </a>

        <nav aria-label="Main" className="hidden md:block">
          <div ref={navRef} className="relative flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.02] p-1">
            <span aria-hidden="true" className="absolute inset-y-1 rounded-full bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] duration-500 ease-out-expo"
              onTransitionEnd={() => setPill((p) => (p.slide ? { ...p, slide: false } : p))}
              style={{ left: pill.left, width: pill.width, opacity: pill.on ? 1 : 0, transitionProperty: pill.slide ? "left, width, opacity" : "opacity" }} />
            {NAV.map((n) => (
              <a key={n.key} href={`#/${n.key}`} aria-current={page === n.key ? "page" : undefined}
                className={`relative rounded-full px-4 py-1.5 text-sm transition-colors duration-200 ${focusRing} ${page === n.key ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}>
                {n.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex items-center gap-2">
          {onSignOut && <button className={`${btn("ghost")} max-md:hidden`} onClick={onSignOut}>Sign out</button>}
          {page === "home" && <a href="#/mandate" className={`${btn("primary")} max-sm:hidden`}>Launch app <Arrow /></a>}
          <button type="button" className={`-mr-2 rounded-lg p-2 text-zinc-300 hover:text-zinc-50 md:hidden ${focusRing}`}
            aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6">
              <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 8h16M4 16h16"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="animate-menu-in border-t border-white/[0.06] px-4 pb-6 pt-1 md:hidden">
          {NAV.map((n) => (
            <a key={n.key} href={`#/${n.key}`} aria-current={page === n.key ? "page" : undefined}
              className={`flex items-center justify-between border-b border-white/[0.05] py-4 text-lg ${focusRing} ${page === n.key ? "text-gold-300" : "text-zinc-200"}`}>
              {n.label}
              <span aria-hidden="true" className="text-zinc-600">→</span>
            </a>
          ))}
          {onSignOut && <button className={`${btn("ghost")} mt-5 w-full`} onClick={onSignOut}>Sign out</button>}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="space-y-5">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-6" />
            <span className="font-semibold tracking-tight text-zinc-300">Kakashi</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">Built on</span>
            <BuiltOn logo="h-4" className="gap-x-6" />
          </div>
        </div>
        <div className="max-w-xl space-y-1.5 text-xs leading-relaxed text-zinc-500 sm:text-right">
          <p>Spending limits are enforced by our backend and an isolated signer. In this demo the operator holds the agent key.</p>
          <p>World proofs are mocked for this event. Payments run on Hedera testnet.</p>
        </div>
      </div>
    </footer>
  );
}
