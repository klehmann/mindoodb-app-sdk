import type { MindooDBAppHostingMode } from "../types";

/**
 * Query parameter the host appends to the app URL so the app can tell how it is being
 * delivered before any asynchronous work has happened.
 */
export const MINDOODB_APP_HOSTING_QUERY_PARAM = "mindoodbAppHosting";

/**
 * Query parameter Haven appends to every app launch URL. The bridge handshake is keyed
 * on it, so its absence means nobody launched this page.
 */
export const MINDOODB_APP_LAUNCH_ID_QUERY_PARAM = "mindoodbAppLaunchId";

/**
 * Reads the launch id Haven put into the current URL, or `null` when there is none.
 *
 * @param search Optional query string, defaults to `window.location.search`.
 */
export function readMindooDBAppLaunchId(search?: string): string | null {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!raw) {
    return null;
  }
  try {
    const launchId = new URLSearchParams(raw).get(MINDOODB_APP_LAUNCH_ID_QUERY_PARAM)?.trim();
    return launchId || null;
  } catch {
    return null;
  }
}

/**
 * True when Haven (or a test host) launched this page, decided synchronously from the URL.
 *
 * Someone who opens the app's address directly — a link in an email, a shared URL — has
 * no host to talk to. Branch on this before calling `connect()` and show a landing page
 * instead (see `renderHavenAppLandingPage`), rather than letting the handshake time out
 * into an error message.
 *
 * @param search Optional query string, defaults to `window.location.search`.
 */
export function isLaunchedByHaven(search?: string): boolean {
  return readMindooDBAppLaunchId(search) !== null;
}

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
