/**
 * The tags a link preview (X, and the same Open Graph tags elsewhere) reads.
 *
 * They have to be in the HTML the server sends. The landing page is drawn later, by
 * JavaScript, and a preview crawler does not run that. `havenBundle()` injects the
 * result of {@link renderHavenAppShareMeta} into `index.html`.
 */

const SUMMARY_CARD = "summary";

export interface HavenAppShareMeta {
  title: string;
  description: string;
  /** Absolute `http(s)` URL of the app root. */
  pageUrl: string;
  /** Absolute `http(s)` URL of a raster icon. SVG is left out: X does not show it. */
  imageUrl?: string;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/[\t\n\r]/g, " ");
}

function meta(attr: "name" | "property", key: string, content: string): string {
  return `<meta ${attr}="${key}" content="${escapeAttr(content)}">`;
}

/** English text, then whatever the publisher wrote first. Previews have no locale. */
function localized(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.en === "string" && record.en.trim()) {
    return record.en.trim();
  }
  for (const text of Object.values(record)) {
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `publicUrl` on a definition: the origin a production build bakes into the share tags. */
export function havenAppPublicUrl(raw: unknown): string | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return havenAppSharePageUrl(raw.publicUrl);
}

/** The app root, or `undefined` when `value` is not an absolute `http(s)` URL. */
export function havenAppSharePageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.origin + "/";
  } catch {
    return undefined;
  }
}

function absoluteRasterUrl(asset: string, pageUrl: string): string | undefined {
  if (/\.svg($|\?)/i.test(asset)) {
    return undefined;
  }
  try {
    const url = new URL(asset, pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * Title, description and icon for one app definition. `pageUrl` is the origin the
 * preview will fetch — the dev server while developing, `publicUrl` in a production build.
 * Returns `undefined` when there is nothing worth a card (no name).
 */
export function havenAppShareMeta(raw: unknown, pageUrl: string): HavenAppShareMeta | undefined {
  const page = havenAppSharePageUrl(pageUrl);
  if (!isRecord(raw) || !page) {
    return undefined;
  }
  const title = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!title) {
    return undefined;
  }
  const listing = isRecord(raw.listing) ? raw.listing : undefined;
  const summary = localized(listing?.summary);
  const descriptionText = localized(listing?.description);
  const description =
    summary ||
    descriptionText.split(/\n\s*\n/)[0]?.trim() ||
    (typeof raw.description === "string" ? raw.description.trim() : "");
  const icon = typeof listing?.icon === "string" ? listing.icon.trim() : "";
  const imageUrl = icon ? absoluteRasterUrl(icon, page) : undefined;
  return { title, description, pageUrl: page, ...(imageUrl ? { imageUrl } : {}) };
}

/**
 * The elements to place before `</head>`. A `summary` card, because the image is the
 * square app icon; a large card would crop it. Open Graph tags are what clients other
 * than X read, and X falls back to them too.
 */
export function renderHavenAppShareMeta(metaData: HavenAppShareMeta): string {
  const lines = [
    "<!-- mindoodb-share -->",
    meta("name", "description", metaData.description),
    meta("property", "og:type", "website"),
    meta("property", "og:title", metaData.title),
    meta("property", "og:description", metaData.description),
    meta("property", "og:url", metaData.pageUrl),
  ];
  if (metaData.imageUrl) {
    lines.push(meta("property", "og:image", metaData.imageUrl), meta("property", "og:image:alt", metaData.title));
  }
  lines.push(
    meta("name", "twitter:card", SUMMARY_CARD),
    meta("name", "twitter:title", metaData.title),
    meta("name", "twitter:description", metaData.description),
  );
  if (metaData.imageUrl) {
    lines.push(meta("name", "twitter:image", metaData.imageUrl));
  }
  lines.push("<!-- /mindoodb-share -->");
  return lines.filter((line) => !line.includes('content=""')).join("\n");
}

const TITLE_PATTERN = /<title>[^<]*<\/title>/i;

/** Inserts the share tags, and sets `<title>` to the app name. A second call changes nothing. */
export function injectHavenAppShareMeta(html: string, metaData: HavenAppShareMeta): string {
  if (html.includes("<!-- mindoodb-share -->")) {
    return html;
  }
  const block = renderHavenAppShareMeta(metaData);
  const titled = TITLE_PATTERN.test(html)
    ? html.replace(TITLE_PATTERN, `<title>${escapeText(metaData.title)}</title>`)
    : html;
  const headEnd = titled.search(/<\/head>/i);
  if (headEnd === -1) {
    return titled;
  }
  return `${titled.slice(0, headEnd)}${block}\n${titled.slice(headEnd)}`;
}
