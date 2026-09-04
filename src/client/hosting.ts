import type { MindooDBAppHostingMode } from "../types";

/**
 * Query parameter the host appends to the app URL so the app can tell how it is being
 * delivered before any asynchronous work has happened.
 */
export const MINDOODB_APP_HOSTING_QUERY_PARAM = "mindoodbAppHosting";

/**
 * Reads the hosting mode synchronously from the current URL.
 *
 * Boot-time decisions — registering a service worker, installing the storage shim —
 * happen long before the bridge handshake completes, so they cannot wait for
 * {@link MindooDBAppSession.getLaunchContext}. Unknown or missing values resolve to
 * `"external"`, which is the behaviour every app had before hosted bundles existed.
 *
 * @param search Optional query string, defaults to `window.location.search`.
 */
export function readMindooDBAppHostingMode(search?: string): MindooDBAppHostingMode {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!raw) {
    return "external";
  }

  try {
    return new URLSearchParams(raw).get(MINDOODB_APP_HOSTING_QUERY_PARAM) === "hosted"
      ? "hosted"
      : "external";
  } catch {
    return "external";
  }
}

/**
 * True when the app runs from a host-served bundle in an opaque origin.
 *
 * In that mode `localStorage`, `sessionStorage`, IndexedDB and
 * `navigator.serviceWorker.register()` are unavailable — note that they *exist* on the
 * global object and only throw when touched, so feature-detecting with `typeof` gives
 * the wrong answer. Branch on this helper instead.
 */
export function isHostedBundleRuntime(search?: string): boolean {
  return readMindooDBAppHostingMode(search) === "hosted";
}
