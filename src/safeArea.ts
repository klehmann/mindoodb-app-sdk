import type { MindooDBAppSafeAreaInsets } from "./types";

/**
 * CSS custom properties on the app's `<html>` with the part of the device's
 * unsafe areas (notch, Dynamic Island, home indicator) that the app's frame
 * covers. Inside Haven they are `0px` until the app asks for
 * {@link MindooDBAppSession.setEdgeToEdge} and the frame actually reaches
 * there. Use them instead of `env(safe-area-inset-*)`, which inside an iframe
 * reports the whole device's insets even where Haven already keeps clear:
 *
 * ```css
 * .tab-bar { padding-bottom: var(--mindoodb-safe-area-bottom, env(safe-area-inset-bottom)); }
 * ```
 *
 * The `env()` fallback covers the app running on its own, outside Haven.
 */
export const MINDOODB_SAFE_AREA_CSS_VARIABLES = {
  top: "--mindoodb-safe-area-top",
  right: "--mindoodb-safe-area-right",
  bottom: "--mindoodb-safe-area-bottom",
  left: "--mindoodb-safe-area-left",
} as const;

/** Sets the variables from `insets` (all `0px` when there are none). No-op without a document. */
export function applySafeAreaVariables(
  insets: MindooDBAppSafeAreaInsets | null | undefined,
  root: { style: { setProperty(name: string, value: string): void } } | undefined = typeof document === "undefined"
    ? undefined
    : document.documentElement,
): void {
  if (!root) {
    return;
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const value = insets?.[side];
    const px = typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : 0;
    root.style.setProperty(MINDOODB_SAFE_AREA_CSS_VARIABLES[side], `${px}px`);
  }
}
