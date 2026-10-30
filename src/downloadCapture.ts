/**
 * Downloads inside Haven's own apps (iOS, Android, desktop) go to the share sheet.
 *
 * A web app downloads a generated file with `<a download href="blob:…">` (or a
 * `data:` URL) and `a.click()`. In a browser that works; in Haven's apps the app
 * runs in a frame of a WebKit/WebView page that cannot download from a frame and
 * turns the click into a navigation of the frame, which Haven blocks ("Haven
 * blocked a network request to blob"). So while `active()` says so, such clicks
 * are taken over: the file is handed to `share` (`session.files.share`: Haven's
 * sheet, then the system share sheet) and the navigation never happens.
 *
 * `blob:` URLs are resolved from the Blob they were made from: the capture wraps
 * `URL.createObjectURL` to remember them (a `fetch` of the URL may be refused by
 * the app's CSP). Everything else (links without `download`, `http(s)` URLs,
 * clicks while inactive) is left alone. Returns a disposer.
 */
import type { MindooDBAppFilesShareResult } from "./types";

export interface DownloadCaptureOptions {
  /** Whether downloads are to be taken over right now (e.g. "running in Haven's iOS app"). */
  active: () => boolean;
  share: (files: File[]) => Promise<MindooDBAppFilesShareResult>;
  /** Defaults to the page's `window`; tests pass their own. */
  window?: Window & typeof globalThis;
}

/** How long a revoked `blob:` URL stays resolvable: apps revoke right after `click()`. */
const REVOKED_GRACE_MS = 60_000;

/** The bytes and type of a `data:` URL, or null when it is not one. */
export function decodeDataUrl(url: string): { type: string; bytes: Uint8Array } | null {
  const match = /^data:([^,]*?),(.*)$/s.exec(url);
  if (!match) {
    return null;
  }
  const meta = match[1] ?? "";
  const payload = match[2] ?? "";
  const base64 = /;base64$/i.test(meta);
  const type = (base64 ? meta.slice(0, -";base64".length) : meta).split(";")[0] || "text/plain";
  if (base64) {
    const binary = atob(payload.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { type, bytes };
  }
  return { type, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

export function installDownloadCapture(options: DownloadCaptureOptions): () => void {
  const found = options.window ?? (typeof window === "undefined" ? undefined : window);
  if (!found || typeof found.URL?.createObjectURL !== "function" || !found.HTMLAnchorElement) {
    return () => undefined;
  }
  const win: Window & typeof globalThis = found;
  const urlApi = win.URL;
  const anchorProto = win.HTMLAnchorElement.prototype;
  const blobs = new Map<string, Blob>();
  const originalCreate = urlApi.createObjectURL;
  const originalRevoke = urlApi.revokeObjectURL;
  const originalClick = anchorProto.click;
  /** Links let through after Haven could not share: their own click must not be taken again. */
  const passing = new WeakSet<HTMLAnchorElement>();
  const clickThrough = (anchor: HTMLAnchorElement) => {
    passing.add(anchor);
    try {
      originalClick.call(anchor);
    } finally {
      passing.delete(anchor);
    }
  };

  urlApi.createObjectURL = function (object: Blob | MediaSource) {
    const url = originalCreate.call(urlApi, object);
    if (object instanceof win.Blob) {
      blobs.set(url, object);
    }
    return url;
  };
  urlApi.revokeObjectURL = function (url: string) {
    // The share sheet reads the Blob after the app revoked the URL; the URL itself
    // is revoked right away as asked.
    originalRevoke.call(urlApi, url);
    if (blobs.has(url)) {
      win.setTimeout(() => blobs.delete(url), REVOKED_GRACE_MS);
    }
  };

  /** The file a download link points at, or null when it is not one to take over. */
  function fileFor(anchor: HTMLAnchorElement): File | null {
    if (!anchor.hasAttribute("download")) {
      return null;
    }
    const href = anchor.href || anchor.getAttribute("href") || "";
    const name = anchor.getAttribute("download") || "download";
    if (href.startsWith("blob:")) {
      const blob = blobs.get(href);
      return blob ? new win.File([blob], name, { type: blob.type }) : null;
    }
    if (href.startsWith("data:")) {
      const decoded = decodeDataUrl(href);
      return decoded ? new win.File([decoded.bytes as BlobPart], name, { type: decoded.type }) : null;
    }
    return null;
  }

  /** Shares the file; when Haven cannot share after all, lets the link do what it would have. */
  function takeOver(anchor: HTMLAnchorElement, file: File) {
    void options
      .share([file])
      .then((result) => {
        if (!result.ok && result.reason !== "cancelled") {
          clickThrough(anchor);
        }
      })
      .catch((error) => {
        console.warn("[mindoodb-app-sdk] Could not hand the download to the share sheet.", error);
      });
  }

  anchorProto.click = function (this: HTMLAnchorElement) {
    const file = options.active() && !passing.has(this) ? fileFor(this) : null;
    if (!file) {
      return originalClick.call(this);
    }
    takeOver(this, file);
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || !options.active()) {
      return;
    }
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[download]") as HTMLAnchorElement | null;
    const file = anchor && !passing.has(anchor) ? fileFor(anchor) : null;
    if (anchor && file) {
      event.preventDefault();
      takeOver(anchor, file);
    }
  };
  win.document.addEventListener("click", onClick, true);

  return () => {
    urlApi.createObjectURL = originalCreate;
    urlApi.revokeObjectURL = originalRevoke;
    anchorProto.click = originalClick;
    win.document.removeEventListener("click", onClick, true);
    blobs.clear();
  };
}
