import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const FIELD = "input, textarea, select, [contenteditable='true']";
const CLICKABLE = "button, a, summary, [role='button'], [role='tab']";

const slides = () => [...document.querySelectorAll<HTMLElement>("[data-slide]")];
const go = (el?: HTMLElement) => el?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * Turns the landing page into a deck: arrow keys, Page Up/Down and Space move one slide, Home/End jump,
 * F toggles fullscreen. A rail on the right shows where you are. Reads every [data-slide] section on the page.
 */
export default function DeckNav() {
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const els = slides();
    setItems(els.map((el) => ({ id: el.id, label: el.dataset.slide ?? el.id })));
    if (typeof IntersectionObserver === "undefined") return;
    // The slide crossing the line 40% down the viewport is the current one.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(els.indexOf(e.target as HTMLElement));
    }, { rootMargin: "-40% 0px -59% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest(FIELD)) return;
      const els = slides();
      // The slide whose top is nearest above the 40% line, so it works mid-scroll too.
      const line = window.innerHeight * 0.4;
      let cur = 0;
      els.forEach((el, i) => { if (el.getBoundingClientRect().top <= line) cur = i; });
      const k = e.key;
      if (k === " " && t?.closest(CLICKABLE)) return; // Space on a button presses it
      if (k === "ArrowDown" || k === "ArrowRight" || k === "PageDown" || (k === " " && !e.shiftKey)) go(els[Math.min(cur + 1, els.length - 1)]);
      else if (k === "ArrowUp" || k === "ArrowLeft" || k === "PageUp" || (k === " " && e.shiftKey)) go(els[Math.max(cur - 1, 0)]);
      else if (k === "Home") go(els[0]);
      else if (k === "End") go(els[els.length - 1]);
      else if (k === "f" || k === "F") {
        if (document.fullscreenElement) void document.exitFullscreen?.();
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (items.length === 0) return null;
  // Portal: <main> animates transform, which would make it the containing block for position: fixed.
  return createPortal(
    <nav aria-label="Slides" className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 xl:block">
      <ol className="flex flex-col items-end gap-2.5">
        {items.map((s, i) => (
          <li key={s.id}>
            <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); go(document.getElementById(s.id) ?? undefined); }}
              aria-current={i === active ? "step" : undefined}
              className="group flex items-center gap-3 rounded-full py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70">
              <span className={`text-[11px] transition-opacity duration-300 ${i === active ? "text-zinc-200 opacity-100" : "text-zinc-500 opacity-0 group-hover:opacity-100"}`}>{s.label}</span>
              <span aria-hidden="true" className={`block h-1.5 rounded-full transition-all duration-500 ease-out-expo ${i === active ? "w-6 bg-gold-400" : "w-1.5 bg-white/25 group-hover:bg-white/50"}`} />
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-right font-mono text-[10px] text-zinc-500">
        {String(active + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
        <span className="mt-1 block text-zinc-600">← → · F</span>
      </p>
    </nav>,
    document.body,
  );
}
