import {
  MINDOODB_APP_DEFINITION_FILE_NAME,
  resolveMindooDBAppListingAssetUrl,
  resolveMindooDBAppLocalizedText,
  validateMindooDBAppDefinition,
  type MindooDBAppDefinition,
} from "./appDefinition";

/**
 * The page an app shows when someone opens its address directly instead of launching it
 * from Haven — a link in an email, a URL the App Builder printed.
 *
 * Without it that person gets a half-rendered app and "could not reach the Haven host".
 * With it they get what the app is, taken from the `listing` in `haven-app.json`, and one
 * button that opens Haven with `?app=<this app's URL>`: Haven then sets up a new
 * environment with the app in it, or adds the app to the one that already exists.
 *
 * Framework-free on purpose: it runs before (and instead of) the app's own UI, so it must
 * not pull the app's bundle into the first paint. Every publisher-supplied string goes in
 * through `textContent`, never as markup.
 */

export const DEFAULT_HAVEN_URL = "https://haven.mindoodb.com";

export interface RenderHavenAppLandingPageOptions {
  /** Haven instance the button opens. Defaults to {@link DEFAULT_HAVEN_URL}. */
  havenUrl?: string;
  /**
   * The app URL Haven installs from. Defaults to the current page without query, hash and
   * a trailing `index.html` — the same URL that serves `haven-app.json`.
   */
  appUrl?: string;
  /** Skips the fetch of `haven-app.json`, e.g. when the app bundles its definition. */
  definition?: MindooDBAppDefinition;
  /** Element the page renders into. Defaults to `document.body`, which is cleared. */
  container?: HTMLElement;
  /** Defaults to `navigator.language`. The page itself speaks English and German. */
  locale?: string;
}

export interface HavenAppLandingPage {
  /** The definition shown, or `null` when `haven-app.json` could not be read. */
  definition: MindooDBAppDefinition | null;
  /** The Haven link behind the main button. */
  installUrl: string;
}

const STRINGS = {
  en: {
    eyebrow: "App for MindooDB Haven",
    cta: "Open in MindooDB Haven",
    ctaHint:
      "Haven sets up your encrypted workspace and installs {label}. Already using Haven? Then the app is simply added.",
    from: "from {origin}",
    by: "by {publisher}",
    screenshots: "Screenshots",
    footer:
      "{label} runs inside MindooDB Haven, which keeps its data end-to-end encrypted and local-first. Opening this address on its own shows only this page.",
    learnMore: "What is MindooDB?",
    fallbackSummary: "This app runs inside MindooDB Haven.",
  },
  de: {
    eyebrow: "App für MindooDB Haven",
    cta: "In MindooDB Haven öffnen",
    ctaHint:
      "Haven richtet deine verschlüsselte Umgebung ein und installiert {label}. Du nutzt Haven schon? Dann wird die App einfach hinzugefügt.",
    from: "von {origin}",
    by: "von {publisher}",
    screenshots: "Screenshots",
    footer:
      "{label} läuft in MindooDB Haven, das ihre Daten Ende-zu-Ende-verschlüsselt und lokal hält. Direkt aufgerufen zeigt diese Adresse nur diese Seite.",
    learnMore: "Was ist MindooDB?",
    fallbackSummary: "Diese App läuft in MindooDB Haven.",
  },
} as const;

type LandingStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

function stringsFor(locale: string): LandingStrings {
  return locale.toLowerCase().startsWith("de") ? STRINGS.de : STRINGS.en;
}

function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** The current page as the app URL: no query, no hash, no trailing `index.html`. */
export function resolveCurrentHavenAppUrl(href = window.location.href): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/index\.html?$/i, "/");
  return url.toString();
}

/** `https://haven.mindoodb.com/?app=<appUrl>` — the link that installs `appUrl`. */
export function buildHavenAppInstallUrl(appUrl: string, havenUrl = DEFAULT_HAVEN_URL): string {
  const url = new URL(havenUrl);
  url.searchParams.set("app", appUrl);
  return url.toString();
}

async function loadDefinition(appUrl: string): Promise<MindooDBAppDefinition | null> {
  try {
    const definitionUrl = new URL(MINDOODB_APP_DEFINITION_FILE_NAME, appUrl.endsWith("/") ? appUrl : `${appUrl}/`);
    const response = await fetch(definitionUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    return validateMindooDBAppDefinition(await response.json()).definition;
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STYLE_ID = "mdb-landing-style";

const STYLE = `
.mdb-landing{--bg:#f4f6fb;--card:#fff;--text:#172033;--muted:#5b6478;--line:#e2e6ef;--accent:#1f3a8a;--accent-text:#fff;
  min-height:100vh;box-sizing:border-box;margin:0;padding:48px 16px;background:var(--bg);color:var(--text);
  font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){.mdb-landing{--bg:#0e1320;--card:#161d2e;--text:#e8ecf5;--muted:#9aa3b8;--line:#263049;--accent:#8fb0ff;--accent-text:#0e1320}}
.mdb-landing *{box-sizing:border-box}
.mdb-landing__card{max-width:880px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:40px;box-shadow:0 20px 60px rgba(15,23,42,.08)}
.mdb-landing__head{display:flex;gap:24px;align-items:center}
.mdb-landing__icon{width:96px;height:96px;border-radius:22px;object-fit:cover;flex:none;box-shadow:0 10px 30px rgba(15,23,42,.18)}
.mdb-landing__eyebrow{margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.mdb-landing__title{margin:0;font-size:clamp(26px,4vw,36px);line-height:1.15}
.mdb-landing__meta{margin:6px 0 0;color:var(--muted);font-size:14px}
.mdb-landing__summary{margin:28px 0 0;font-size:19px}
.mdb-landing__cta{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin:28px 0 0}
.mdb-landing__button{display:inline-block;padding:14px 22px;border-radius:12px;background:var(--accent);color:var(--accent-text);font-weight:600;text-decoration:none}
.mdb-landing__button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.mdb-landing__hint{margin:0;max-width:420px;color:var(--muted);font-size:14px}
.mdb-landing__description{margin:32px 0 0}
.mdb-landing__description p{margin:0 0 12px}
.mdb-landing__shots-title{margin:32px 0 12px;font-size:15px;color:var(--muted);font-weight:600}
.mdb-landing__shots{display:grid;grid-auto-flow:column;grid-auto-columns:min(78%,420px);gap:16px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x mandatory}
.mdb-landing__shot{margin:0;scroll-snap-align:start}
.mdb-landing__shot img{width:100%;border-radius:14px;border:1px solid var(--line);display:block}
.mdb-landing__shot figcaption{margin-top:8px;font-size:13px;color:var(--muted)}
.mdb-landing__footer{margin:36px 0 0;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.mdb-landing__footer a{color:inherit}
@media (max-width:560px){.mdb-landing{padding:16px}.mdb-landing__card{padding:24px;border-radius:18px}.mdb-landing__head{flex-direction:column;align-items:flex-start}.mdb-landing__icon{width:72px;height:72px}}
`;

/**
 * Replaces the page with the app's landing page. Call it instead of mounting the app
 * when {@link isLaunchedByHaven} is `false`.
 */
export async function renderHavenAppLandingPage(
  options: RenderHavenAppLandingPageOptions = {},
): Promise<HavenAppLandingPage> {
  const appUrl = options.appUrl ?? resolveCurrentHavenAppUrl();
  const locale = options.locale ?? (typeof navigator === "undefined" ? "en" : navigator.language || "en");
  const strings = stringsFor(locale);
  const definition = options.definition ?? (await loadDefinition(appUrl));
  const installUrl = buildHavenAppInstallUrl(appUrl, options.havenUrl);
  const listing = definition?.listing;
  const label = definition?.label ?? (document.title || new URL(appUrl).host);
  const origin = new URL(appUrl).host;

  if (!document.getElementById(STYLE_ID)) {
    const style = el("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.append(style);
  }
  document.title = label;

  const root = el("main", "mdb-landing");
  root.dataset.testid = "haven-app-landing";
  const card = el("article", "mdb-landing__card");
  root.append(card);

  const head = el("header", "mdb-landing__head");
  const iconUrl = listing?.icon ? resolveMindooDBAppListingAssetUrl(listing.icon, appUrl) : null;
  if (iconUrl) {
    const icon = el("img", "mdb-landing__icon");
    icon.src = iconUrl;
    icon.alt = "";
    head.append(icon);
  }
  const titles = el("div");
  titles.append(el("p", "mdb-landing__eyebrow", strings.eyebrow), el("h1", "mdb-landing__title", label));
  const meta = [format(strings.from, { origin })];
  if (listing?.publisher) {
    meta.unshift(format(strings.by, { publisher: listing.publisher.name }));
  }
  titles.append(el("p", "mdb-landing__meta", meta.join(" · ")));
  head.append(titles);
  card.append(head);

  const summary =
    resolveMindooDBAppLocalizedText(listing?.summary, locale) || definition?.description || strings.fallbackSummary;
  card.append(el("p", "mdb-landing__summary", summary));

  const cta = el("div", "mdb-landing__cta");
  const button = el("a", "mdb-landing__button", strings.cta);
  button.href = installUrl;
  button.rel = "noopener";
  button.dataset.testid = "haven-app-landing-install";
  cta.append(button, el("p", "mdb-landing__hint", format(strings.ctaHint, { label })));
  card.append(cta);

  const description = resolveMindooDBAppLocalizedText(listing?.description, locale);
  if (description) {
    const block = el("section", "mdb-landing__description");
    for (const paragraph of description.split(/\n\s*\n/)) {
      if (paragraph.trim()) block.append(el("p", undefined, paragraph.trim()));
    }
    card.append(block);
  }

  const screenshots = (listing?.screenshots ?? [])
    .map((shot) => ({
      url: resolveMindooDBAppListingAssetUrl(shot.file, appUrl),
      caption: resolveMindooDBAppLocalizedText(shot.caption, locale),
    }))
    .filter((shot): shot is { url: string; caption: string } => Boolean(shot.url));
  if (screenshots.length) {
    card.append(el("h2", "mdb-landing__shots-title", strings.screenshots));
    const strip = el("div", "mdb-landing__shots");
    for (const shot of screenshots) {
      const figure = el("figure", "mdb-landing__shot");
      const image = el("img");
      image.src = shot.url;
      image.alt = shot.caption;
      image.loading = "lazy";
      figure.append(image);
      if (shot.caption) figure.append(el("figcaption", undefined, shot.caption));
      strip.append(figure);
    }
    card.append(strip);
  }

  const footer = el("footer", "mdb-landing__footer");
  footer.append(format(strings.footer, { label }), " ");
  const learnMore = el("a", undefined, strings.learnMore);
  learnMore.href = "https://mindoodb.com";
  learnMore.rel = "noopener";
  footer.append(learnMore);
  card.append(footer);

  const container = options.container ?? document.body;
  container.replaceChildren(root);
  if (container === document.body) {
    document.body.style.margin = "0";
  }
  return { definition, installUrl };
}
