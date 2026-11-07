import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reducedMotion, useInView } from "./kit";

// Decorative motion only: nothing here changes content, and all of it is off for reduced motion or touch.
const fancyPointer = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches && !reducedMotion();

const INTERACTIVE = "a, button, summary, [role='button'], [role='tab'], input, textarea, select";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Cursor ring + dot, a soft gold spotlight, card glow (.fx-card), 3D tilt ([data-tilt]),
 * magnetic buttons ([data-magnetic]) and hero parallax (--px/--py on <html>). One rAF loop drives it all.
 */
export function CursorFx() {
  const [on, setOn] = useState(false);
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);

  useEffect(() => setOn(fancyPointer()), []);

  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const p = { x: innerWidth / 2, y: innerHeight / 3 }; // target
    const r = { ...p }; // ring, trails
    const g = { ...p }; // glow, trails more
    let hot = false, seen = false, raf = 0;
    let tilt: HTMLElement | null = null;
    const mags = new Set<HTMLElement>();

    const move = (e: PointerEvent) => {
      p.x = e.clientX; p.y = e.clientY;
      if (!seen) { seen = true; Object.assign(r, p); Object.assign(g, p); root.classList.add("fx-cursor-on"); }
      const t = e.target instanceof Element ? e.target : null;
      hot = !!t?.closest(INTERACTIVE);
      root.style.setProperty("--px", (p.x / innerWidth * 2 - 1).toFixed(3));
      root.style.setProperty("--py", (p.y / innerHeight * 2 - 1).toFixed(3));

      const card = t?.closest<HTMLElement>(".fx-card");
      if (card) {
        const b = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${p.x - b.left}px`);
        card.style.setProperty("--my", `${p.y - b.top}px`);
      }

      const nt = t?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (tilt && tilt !== nt) tilt.style.transform = "";
      tilt = nt;
      if (tilt) {
        const b = tilt.getBoundingClientRect();
        const nx = (p.x - b.left) / b.width - 0.5, ny = (p.y - b.top) / b.height - 0.5;
        tilt.style.transform = `perspective(1400px) rotateX(${(-ny * 6).toFixed(2)}deg) rotateY(${(nx * 8).toFixed(2)}deg)`;
      }

      const m = t?.closest<HTMLElement>("[data-magnetic]");
      for (const el of mags) if (el !== m) { el.style.translate = ""; mags.delete(el); }
      if (m) {
        const b = m.getBoundingClientRect();
        m.style.translate = `${((p.x - b.left - b.width / 2) * 0.25).toFixed(1)}px ${((p.y - b.top - b.height / 2) * 0.35).toFixed(1)}px`;
        mags.add(m);
      }
    };
    const leave = () => { seen = false; root.classList.remove("fx-cursor-on"); if (tilt) tilt.style.transform = ""; tilt = null; };
    // Pulse the inner circle only: scaling the positioned ring would also scale its translate and make it jump.
    const down = () => (ring.current?.firstElementChild as HTMLElement | null)?.animate(
      [{ scale: 1 }, { scale: 0.7 }, { scale: 1 }], { duration: 350, easing: "cubic-bezier(.16,1,.3,1)" });

    const frame = () => {
      r.x = lerp(r.x, p.x, 0.2); r.y = lerp(r.y, p.y, 0.2);
      g.x = lerp(g.x, p.x, 0.08); g.y = lerp(g.y, p.y, 0.08);
      if (ring.current) { ring.current.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`; ring.current.dataset.hot = String(hot); }
      if (dot.current) dot.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      if (glow.current) glow.current.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    addEventListener("pointermove", move, { passive: true });
    addEventListener("pointerdown", down);
    document.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", down);
      document.removeEventListener("pointerleave", leave);
      root.classList.remove("fx-cursor-on");
      root.style.removeProperty("--px"); root.style.removeProperty("--py");
      if (tilt) tilt.style.transform = "";
      for (const el of mags) el.style.translate = "";
    };
  }, [on]);

  if (!on) return null;
  // Portal: <main> animates transform, which would make it the containing block for position: fixed.
  return createPortal(
    <div aria-hidden="true" className="fx-cursor pointer-events-none fixed inset-0 z-[60]">
      <div ref={glow} className="fx-glow" />
      <div ref={ring} className="fx-ring"><span /></div>
      <div ref={dot} className="fx-dot" />
    </div>,
    document.body,
  );
}

/** Thin gold scroll-progress bar under the header. */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    };
    f();
    addEventListener("scroll", f, { passive: true });
    addEventListener("resize", f);
    return () => { removeEventListener("scroll", f); removeEventListener("resize", f); };
  }, []);
  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[55] h-[2px]">
      <div ref={bar} className="h-full origin-left bg-gradient-to-r from-gold-500 via-gold-300 to-gold-200 shadow-[0_0_12px_rgba(240,185,85,0.6)]" style={{ transform: "scaleX(0)" }} />
    </div>,
    document.body,
  );
}

/** Drifting gold dust behind the hero; the cursor pushes it away. Paused off-screen. */
export function HeroDust() {
  const cv = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  const inView = useInView(cv, "0px");
  useEffect(() => setOn(typeof window !== "undefined" && !!window.matchMedia && !reducedMotion()), []);

  useEffect(() => {
    const c = cv.current;
    const ctx = on && inView ? c?.getContext("2d") : null;
    if (!c || !ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0;
    const mouse = { x: -1e4, y: -1e4 };
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const N = Math.round(Math.min(90, (w * h) / 14000));
    const pts = Array.from({ length: N }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, r: 0.6 + Math.random() * 1.6, s: 0.15 + Math.random() * 0.35, a: 0.25 + Math.random() * 0.5 }));
    const move = (e: PointerEvent) => { const b = c.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const q of pts) {
        const dx = q.x - mouse.x, dy = q.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 140 * 140) { const d = Math.sqrt(d2) || 1; const f = (1 - d / 140) * 0.6; q.vx += (dx / d) * f; q.vy += (dy / d) * f; }
        q.vx *= 0.92; q.vy *= 0.92;
        q.x += q.vx; q.y += q.vy - q.s;
        if (q.y < -5) { q.y = h + 5; q.x = Math.random() * w; }
        if (q.x < -5) q.x = w + 5; else if (q.x > w + 5) q.x = -5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(247,210,138,${q.a * (1 - q.y / h * 0.6)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    addEventListener("pointermove", move, { passive: true });
    addEventListener("resize", size);
    return () => { cancelAnimationFrame(raf); removeEventListener("pointermove", move); removeEventListener("resize", size); };
  }, [on, inView]);

  return <canvas ref={cv} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}
