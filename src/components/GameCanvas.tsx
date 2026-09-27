"use client";

import { useEffect, useRef, useState } from "react";
import { SkipForward } from "lucide-react";
import { Director } from "@/game/director";
import { Renderer } from "@/game/renderer";
import { colsOf, goalHalf, rowsOf } from "@/game/engine";
import { sound } from "@/game/sound";

interface GoalDock {
  top: number;
  left: number;
  width: number;
}

export default function GameCanvas({ director }: { director: Director }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState(() => director.hud());
  const [dock, setDock] = useState<GoalDock | null>(null);

  useEffect(() => director.subscribe(setHud), [director]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    if (typeof canvas.getContext !== "function" || !canvas.getContext("2d")) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    let renderer: Renderer;
    try {
      renderer = new Renderer(
        canvas,
        colsOf(director.match.cfg),
        rowsOf(director.match.cfg),
        dpr,
      );
    } catch {
      // Canvas 2D unavailable — leave the menu usable instead of crashing.
      return;
    }

    const dprOf = () => Math.min(2.5, window.devicePixelRatio || 1);
    let curW = 0;
    let curH = 0;
    let curDpr = dprOf();

    const positionPhonePass = () => {
      const L = renderer.layout;
      const goalRight = L.ox + ((L.cols - 1) / 2 + goalHalf(L.cols)) * L.cellW;
      // Keep a 48px touch target, but fit even on the narrowest phones.
      const width = Math.min(112, Math.max(92, Math.round(curW * 0.28)));
      const gap = Math.max(8, Math.min(12, L.cellW * 0.25));
      const left = Math.round(Math.max(8, Math.min(curW - width - 8, goalRight + gap)));
      // The button begins just BEHIND the last playable row, beside the
      // rectangular goal. It cannot cover a node on that row or the goal mouth.
      const top = Math.round(L.oy + (L.rows - 1) * L.cellH + Math.max(3, L.cellH * 0.1));
      setDock((previous) =>
        previous?.top === top && previous.left === left && previous.width === width
          ? previous
          : { top, left, width },
      );
    };

    // Applies the current wrapper size. Cheap no-op when nothing changed, so it
    // is safe to call every frame while a rotation animation settles (each real
    // change re-bakes the arena texture, which we must not do needlessly).
    const applySize = () => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(60, Math.round(r.width));
      const h = Math.max(60, Math.round(r.height));
      const dpr = dprOf();
      if (w === curW && h === curH && Math.abs(dpr - curDpr) < 0.01) return;
      curW = w;
      curH = h;
      curDpr = dpr;
      renderer.setDpr(dpr);
      renderer.setSize(colsOf(director.match.cfg), rowsOf(director.match.cfg));
      // Same phone breakpoint as the layout/render code: drives tap-target sizes.
      director.setPhone(Math.min(w, h) < 600);
      renderer.resize(w, h);
      syncScroll();
      positionPhonePass();
    };

    // A long phone pitch overflows the viewport: let the wrapper scroll
    // vertically. `touch-action: pan-y` keeps native scrolling while the game
    // still receives pointer events for taps and ball drags; pinch-zoom stays
    // disabled. When everything fits, scrolling is off and touch is fully ours.
    const syncScroll = () => {
      const overflows = renderer.contentHeight > curH + 1;
      wrap.style.overflowY = overflows ? "auto" : "hidden";
      canvas.style.touchAction = overflows ? "pan-y" : "none";
    };
    applySize();

    // Mobile browsers report stale metrics right after `orientationchange`, and
    // keep animating (URL bar collapse, split-view resize) for a few hundred ms.
    // Instead of guessing one delay, re-measure every frame until it settles.
    let settleUntil = 0;
    const settle = (ms: number) => {
      settleUntil = Math.max(settleUntil, performance.now() + ms);
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        applySize();
        settle(400);
      });
      ro.observe(wrap);
    }

    const onResize = () => settle(600);
    const onRotate = () => settle(1200); // rotation animation + layout reflow
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onRotate);
    const so = window.screen?.orientation;
    so?.addEventListener?.("change", onRotate);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);

    let raf = 0;
    let last = performance.now();
    let lastCols = colsOf(director.match.cfg);
    let lastRows = rowsOf(director.match.cfg);
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now < settleUntil) applySize(); // track the viewport while it moves
      director.tick(now, dt);
      renderer.setArena(director.arena);
      const cols = colsOf(director.match.cfg);
      const rows = rowsOf(director.match.cfg);
      if (cols !== lastCols || rows !== lastRows) {
        lastCols = cols;
        lastRows = rows;
        renderer.setSize(cols, rows);
        renderer.resize(curW, curH);
        syncScroll();
        positionPhonePass();
      }
      renderer.draw(director.view(), director.particles, director.shake, dt, now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const toNode = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return renderer.toNode(e.clientX - rect.left, e.clientY - rect.top);
    };
    // While the ball is being dragged we must own the gesture completely:
    // otherwise a scrollable pitch would start panning mid-swipe. The
    // non-passive touchmove handler cancels native scrolling only during a drag.
    let dragging = false;
    const onTouchMove = (e: TouchEvent) => {
      if (dragging) e.preventDefault();
    };
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    const down = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Invalid/stale pointer id — the tap itself can still be processed.
      }
      const n = toNode(e);
      director.pointerDown(n.x, n.y);
      dragging = director.isDragging();
    };
    let lastCursor = "";
    const move = (e: PointerEvent) => {
      const n = toNode(e);
      director.pointerMove(n.x, n.y);
      if (e.pointerType === "mouse") {
        const c = director.cursorAt(n.x, n.y);
        if (c !== lastCursor) {
          lastCursor = c;
          canvas.style.cursor = c;
        }
      }
    };
    const up = () => {
      director.pointerUp();
      dragging = false;
      lastCursor = "";
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onRotate);
      so?.removeEventListener?.("change", onRotate);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [director]);

  return (
    <div ref={wrapRef} className="game-canvas-wrap absolute inset-0 overflow-hidden overscroll-contain">
      <canvas ref={canvasRef} className="block select-none" style={{ cursor: "default", touchAction: "none" }} />
      {hud.phone && hud.canEndTurn && dock && (
        <button
          type="button"
          onClick={() => {
            sound.unlock();
            sound.ui();
            director.endTurn();
          }}
          aria-label="Пас — завершить ход и передать мяч сопернику"
          title="Завершить ход и передать мяч"
          className="absolute z-20 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#9fe870]/50 bg-[#0b170e]/95 px-3 text-[12px] font-bold uppercase tracking-[0.14em] text-[#b9ef8c] shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-sm transition-colors hover:border-[#9fe870] hover:bg-[#193020] active:scale-[0.98]"
          style={{ top: dock.top, left: dock.left, width: dock.width, touchAction: "manipulation" }}
        >
          <SkipForward size={16} aria-hidden="true" />
          Пас
        </button>
      )}
    </div>
  );
}
