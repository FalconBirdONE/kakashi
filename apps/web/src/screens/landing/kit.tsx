import { useEffect, useState, type ReactNode, type RefObject } from "react";

export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True while the element overlaps the viewport (re-fires on every enter and leave). Always true without IntersectionObserver. */
export function useInView(ref: RefObject<Element | null>, rootMargin = "-15% 0px -15% 0px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

/** Advances 0..count-1 every `ms` while `playing`, wrapping at the end. */
export function useTicker(count: number, ms: number, playing: boolean): [number, (n: number) => void] {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((n) => (n + 1) % count), ms);
    return () => clearTimeout(t);
  }, [i, count, ms, playing]);
  return [i, setI];
}

/** One "slide" of the landing deck. `data-slide` is what the deck rail and keyboard navigation read. */
export function Slide({ id, label, children, className = "" }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} data-slide={label} aria-label={label} className={`relative scroll-mt-16 ${className}`}>
      {children}
    </section>
  );
}

export const Wrap = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>
);
export const Eyebrow = ({ n, children }: { n?: string; children: ReactNode }) => (
  <p className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.16em] text-gold-400">
    {n && <span className="font-mono text-zinc-500">{n}</span>}{children}
  </p>
);
export const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl">{children}</h2>
);
export const Accent = ({ children, className = "text-zinc-400" }: { children: ReactNode; className?: string }) => (
  <span className={`font-serif font-normal italic ${className}`}>{children}</span>
);
export const Lead = ({ children }: { children: ReactNode }) => <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-400">{children}</p>;

/** Monospace "on the wire" block. */
export const Wire = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <pre className={`overflow-x-auto rounded-xl border border-white/[0.06] bg-black/40 p-4 font-mono text-[11.5px] leading-relaxed text-zinc-300 sm:text-xs ${className}`}>{children}</pre>
);

export const Check = ({ className = "size-3.5" }: { className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className={className}><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const Cross = ({ className = "size-3.5" }: { className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className={className}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);

/** Round play/pause and step buttons shared by the animated demos. */
export function Controls({ playing, onToggle, onPrev, onNext, label }: { playing: boolean; onToggle: () => void; onPrev?: () => void; onNext?: () => void; label: string }) {
  const b = "flex size-9 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] text-zinc-300 transition-colors hover:border-white/25 hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`${label} controls`}>
      {onPrev && <button type="button" className={b} onClick={onPrev} aria-label="Previous step"><svg aria-hidden="true" viewBox="0 0 16 16" className="size-4"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
      <button type="button" className={b} onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
          {playing ? <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M5 3.5v9l7.5-4.5L5 3.5z" fill="currentColor" />}
        </svg>
      </button>
      {onNext && <button type="button" className={b} onClick={onNext} aria-label="Next step"><svg aria-hidden="true" viewBox="0 0 16 16" className="size-4"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
    </div>
  );
}
