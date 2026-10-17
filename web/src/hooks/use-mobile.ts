import { useEffect, useState } from "react";

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Narrow layout (phones, small tablets in portrait). */
export const useIsMobile = () => useMedia("(max-width: 767px)");

/** Touch-first device, regardless of width. */
export const useIsTouch = () => useMedia("(pointer: coarse)");

/**
 * Keep `--app-height` equal to the visual viewport, so when the on-screen keyboard opens the app
 * shrinks instead of being covered (iOS Safari does not resize the layout viewport).
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Android shrinks innerHeight together with the keyboard, so compare against the tallest
    // viewport seen at the current width (reset on rotation).
    let tallest = 0;
    let width = 0;
    const update = () => {
      if (vv.width !== width) {
        width = vv.width;
        tallest = 0;
      }
      tallest = Math.max(tallest, vv.height);
      document.documentElement.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      // Keyboard open ≈ visual viewport much shorter than the window: lets CSS hide chrome (bottom nav).
      document.documentElement.dataset.keyboard = vv.height < tallest * 0.8 ? "open" : "closed";
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
