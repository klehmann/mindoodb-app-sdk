import {
  MINDOODB_APP_DEFINITION_FILE_NAME,
  resolveMindooDBAppListingAssetUrl,
  resolveMindooDBAppLocalizedText,
  validateMindooDBAppDefinition,
  type MindooDBAppDefinition,
} from "./appDefinition";
import { parseListingMarkdown, type ListingInline } from "./listingMarkdown";

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

/** Workspace icon files Haven also looks for in a hosted bundle. */
const APP_ICON_FALLBACKS = ["appicon.png", "appicon.webp", "appicon.svg"] as const;

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
  /**
   * Defaults to `navigator.language`. Picks the page language (Haven's eight; others fall
   * back to English) and the matching texts of the listing.
   */
  locale?: string;
}

export interface HavenAppLandingPage {
  /** The definition shown, or `null` when `haven-app.json` could not be read. */
  definition: MindooDBAppDefinition | null;
  /** The Haven link behind the main button. */
  installUrl: string;
}

/** The languages Haven's UI speaks; the landing page speaks the same ones. */
export const HAVEN_APP_LANDING_LOCALES = ["en", "de", "es", "fr", "it", "nb", "nl", "pl"] as const;
export type HavenAppLandingLocale = (typeof HAVEN_APP_LANDING_LOCALES)[number];

const EN = {
  eyebrow: "App for MindooDB Haven",
  cta: "Open in MindooDB Haven",
  ctaHint:
    "Haven sets up your encrypted workspace and installs {label}. Already using Haven? Then the app is simply added.",
  from: "from {origin}",
  by: "by {publisher}",
  screenshots: "Screenshots",
  enlargeShot: "Show screenshot {number} larger",
  previousShot: "Previous screenshot",
  nextShot: "Next screenshot",
  closeShot: "Close",
  footer:
    "{label} runs inside MindooDB Haven, which keeps its data end-to-end encrypted and local-first. Opening this address on its own shows only this page.",
  learnMore: "What is MindooDB?",
  fallbackSummary: "This app runs inside MindooDB Haven.",
};

type LandingStrings = { [K in keyof typeof EN]: string };

/**
 * Every fixed text of the page in every Haven language. French uses a non-breaking space
 * (U+00A0) before `?`, like Haven's own French strings.
 */
export const HAVEN_APP_LANDING_STRINGS = {
  en: EN,
  de: {
    eyebrow: "App für MindooDB Haven",
    cta: "In MindooDB Haven öffnen",
    ctaHint:
      "Haven richtet deine verschlüsselte Umgebung ein und installiert {label}. Du nutzt Haven schon? Dann wird die App einfach hinzugefügt.",
    from: "von {origin}",
    by: "von {publisher}",
    screenshots: "Screenshots",
    enlargeShot: "Screenshot {number} groß anzeigen",
    previousShot: "Vorheriger Screenshot",
    nextShot: "Nächster Screenshot",
    closeShot: "Schließen",
    footer:
      "{label} läuft in MindooDB Haven, das ihre Daten Ende-zu-Ende-verschlüsselt und lokal hält. Direkt aufgerufen zeigt diese Adresse nur diese Seite.",
    learnMore: "Was ist MindooDB?",
    fallbackSummary: "Diese App läuft in MindooDB Haven.",
  },
  es: {
    eyebrow: "App para MindooDB Haven",
    cta: "Abrir en MindooDB Haven",
    ctaHint:
      "Haven configura tu entorno cifrado e instala {label}. ¿Ya usas Haven? Entonces la app simplemente se añade.",
    from: "desde {origin}",
    by: "de {publisher}",
    screenshots: "Capturas de pantalla",
    enlargeShot: "Ver la captura {number} en grande",
    previousShot: "Captura anterior",
    nextShot: "Captura siguiente",
    closeShot: "Cerrar",
    footer:
      "{label} funciona dentro de MindooDB Haven, que cifra sus datos de extremo a extremo y los guarda primero en local. Abierta directamente, esta dirección solo muestra esta página.",
    learnMore: "¿Qué es MindooDB?",
    fallbackSummary: "Esta app funciona dentro de MindooDB Haven.",
  },
  fr: {
    eyebrow: "App pour MindooDB Haven",
    cta: "Ouvrir dans MindooDB Haven",
    ctaHint:
      "Haven configure votre environnement chiffré et installe {label}. Vous utilisez déjà Haven\u00a0? L'app y est alors simplement ajoutée.",
    from: "sur {origin}",
    by: "par {publisher}",
    screenshots: "Captures d'écran",
    enlargeShot: "Agrandir la capture {number}",
    previousShot: "Capture précédente",
    nextShot: "Capture suivante",
    closeShot: "Fermer",
    footer:
      "{label} fonctionne dans MindooDB Haven, qui chiffre ses données de bout en bout et les conserve d'abord en local. Ouverte directement, cette adresse n'affiche que cette page.",
    learnMore: "Qu'est-ce que MindooDB\u00a0?",
    fallbackSummary: "Cette app fonctionne dans MindooDB Haven.",
  },
  it: {
    eyebrow: "App per MindooDB Haven",
    cta: "Apri in MindooDB Haven",
    ctaHint:
      "Haven configura il tuo ambiente cifrato e installa {label}. Usi già Haven? Allora l'app viene semplicemente aggiunta.",
    from: "da {origin}",
    by: "di {publisher}",
    screenshots: "Screenshot",
    enlargeShot: "Mostra lo screenshot {number} in grande",
    previousShot: "Screenshot precedente",
    nextShot: "Screenshot successivo",
    closeShot: "Chiudi",
    footer:
      "{label} funziona in MindooDB Haven, che cifra i suoi dati end-to-end e li tiene prima di tutto in locale. Aperto direttamente, questo indirizzo mostra solo questa pagina.",
    learnMore: "Che cos'è MindooDB?",
    fallbackSummary: "Questa app funziona in MindooDB Haven.",
  },
  nb: {
    eyebrow: "App for MindooDB Haven",
    cta: "Åpne i MindooDB Haven",
    ctaHint:
      "Haven setter opp det krypterte miljøet ditt og installerer {label}. Bruker du Haven allerede? Da blir appen bare lagt til.",
    from: "fra {origin}",
    by: "fra {publisher}",
    screenshots: "Skjermbilder",
    enlargeShot: "Vis skjermbilde {number} større",
    previousShot: "Forrige skjermbilde",
    nextShot: "Neste skjermbilde",
    closeShot: "Lukk",
    footer:
      "{label} kjører i MindooDB Haven, som krypterer dataene ende-til-ende og holder dem lokalt først. Åpnet direkte viser denne adressen bare denne siden.",
    learnMore: "Hva er MindooDB?",
    fallbackSummary: "Denne appen kjører i MindooDB Haven.",
  },
  nl: {
    eyebrow: "App voor MindooDB Haven",
    cta: "Openen in MindooDB Haven",
    ctaHint:
      "Haven richt je versleutelde omgeving in en installeert {label}. Gebruik je Haven al? Dan wordt de app gewoon toegevoegd.",
    from: "van {origin}",
    by: "van {publisher}",
    screenshots: "Schermafbeeldingen",
    enlargeShot: "Schermafbeelding {number} groot tonen",
    previousShot: "Vorige schermafbeelding",
    nextShot: "Volgende schermafbeelding",
    closeShot: "Sluiten",
    footer:
      "{label} draait in MindooDB Haven, dat de gegevens end-to-end versleutelt en eerst lokaal bewaart. Rechtstreeks geopend toont dit adres alleen deze pagina.",
    learnMore: "Wat is MindooDB?",
    fallbackSummary: "Deze app draait in MindooDB Haven.",
  },
  pl: {
    eyebrow: "Aplikacja dla MindooDB Haven",
    cta: "Otwórz w MindooDB Haven",
    ctaHint:
      "Haven skonfiguruje twoje zaszyfrowane środowisko i zainstaluje {label}. Już korzystasz z Haven? Wtedy aplikacja zostanie po prostu dodana.",
    from: "z {origin}",
    by: "od {publisher}",
    screenshots: "Zrzuty ekranu",
    enlargeShot: "Pokaż zrzut ekranu {number} w powiększeniu",
    previousShot: "Poprzedni zrzut ekranu",
    nextShot: "Następny zrzut ekranu",
    closeShot: "Zamknij",
    footer:
      "{label} działa w MindooDB Haven, który szyfruje dane end-to-end i przechowuje je najpierw lokalnie. Otwarty bezpośrednio ten adres pokazuje tylko tę stronę.",
    learnMore: "Czym jest MindooDB?",
    fallbackSummary: "Ta aplikacja działa w MindooDB Haven.",
  },
} as const satisfies Record<HavenAppLandingLocale, LandingStrings>;

/**
 * The page language for a BCP 47 tag: its primary subtag when Haven speaks it (`de-AT` →
 * `de`), Norwegian `no`/`nn` → `nb`, anything else → `en`.
 */
export function resolveHavenAppLandingLocale(tag: string): HavenAppLandingLocale {
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  const language = primary === "no" || primary === "nn" ? "nb" : primary;
  return (HAVEN_APP_LANDING_LOCALES as readonly string[]).includes(language)
    ? (language as HavenAppLandingLocale)
    : "en";
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

function externalLink(href: string): HTMLAnchorElement {
  const link = el("a");
  link.href = href;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  return link;
}

function appendInline(parent: HTMLElement, nodes: ListingInline[]): void {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.append(node.text);
    } else if (node.type === "code") {
      parent.append(el("code", undefined, node.text));
    } else {
      const child = node.type === "link" ? externalLink(node.href) : el(node.type);
      appendInline(child, node.children);
      parent.append(child);
    }
  }
}

/** `descriptionMarkdown` as elements; its tree only ever becomes text nodes and a few tags. */
function renderMarkdownDescription(block: HTMLElement, markdown: string): void {
  for (const entry of parseListingMarkdown(markdown)) {
    if (entry.type === "list") {
      const list = el(entry.ordered ? "ol" : "ul");
      for (const item of entry.items) {
        const li = el("li");
        appendInline(li, item);
        list.append(li);
      }
      block.append(list);
    } else {
      const node = el(entry.type === "heading" ? "h2" : "p");
      appendInline(node, entry.children);
      block.append(node);
    }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A stroked 24×24 icon; `path` is fixed markup from this file, never publisher input. */
function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(SVG_NS, "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

function iconButton(className: string, label: string, path: string): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(path));
  return button;
}

/** Horizontal distance a swipe has to cover before it changes the screenshot. */
const SWIPE_THRESHOLD_PX = 48;

interface ScreenshotLightbox {
  element: HTMLElement;
  open(index: number, opener?: HTMLElement): void;
}

/**
 * The large view behind the screenshot strip: one screenshot at a time with its caption,
 * previous/next by button, arrow keys and swipe (wrapping around at the ends), closed by
 * Escape, the close button or a click beside the image. Focus stays inside while it is
 * open and returns to the thumbnail that opened it.
 */
function createScreenshotLightbox(
  shots: { url: string; caption: string }[],
  strings: LandingStrings,
): ScreenshotLightbox {
  const element = el("div", "mdb-landing__lightbox");
  element.hidden = true;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", strings.screenshots);
  element.dataset.testid = "haven-app-landing-lightbox";

  const bar = el("div", "mdb-landing__lightbox-bar");
  const count = el("span", "mdb-landing__lightbox-count");
  count.setAttribute("aria-live", "polite");
  const close = iconButton("mdb-landing__lightbox-close", strings.closeShot, "M6 6l12 12M18 6L6 18");
  bar.append(count, close);

  const stage = el("div", "mdb-landing__lightbox-stage");
  const image = el("img");
  image.draggable = false;
  const previous = iconButton("mdb-landing__lightbox-prev", strings.previousShot, "M15 5l-7 7 7 7");
  const next = iconButton("mdb-landing__lightbox-next", strings.nextShot, "M9 5l7 7-7 7");
  stage.append(image);
  if (shots.length > 1) stage.append(previous, next);

  const caption = el("p", "mdb-landing__lightbox-caption");
  element.append(bar, stage, caption);

  let current = 0;
  let opener: HTMLElement | undefined;
  let previousOverflow = "";

  const show = (index: number) => {
    current = (index + shots.length) % shots.length;
    const shot = shots[current]!;
    image.src = shot.url;
    image.alt = shot.caption;
    caption.textContent = shot.caption;
    count.textContent = `${current + 1} / ${shots.length}`;
    // Warm the neighbours so stepping through does not wait on the network.
    for (const offset of [-1, 1]) {
      const neighbour = shots[(current + offset + shots.length) % shots.length];
      if (neighbour && shots.length > 1) new Image().src = neighbour.url;
    }
  };

  const hide = () => {
    if (element.hidden) return;
    element.hidden = true;
    document.documentElement.style.overflow = previousOverflow;
    document.removeEventListener("keydown", onKey, true);
    opener?.focus();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      hide();
    } else if (event.key === "ArrowLeft" && shots.length > 1) {
      show(current - 1);
    } else if (event.key === "ArrowRight" && shots.length > 1) {
      show(current + 1);
    } else if (event.key === "Home") {
      show(0);
    } else if (event.key === "End") {
      show(shots.length - 1);
    } else if (event.key === "Tab") {
      // Keep focus on the dialog's own buttons.
      const focusable = [close, ...(shots.length > 1 ? [previous, next] : [])];
      const position = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const target = event.shiftKey
        ? focusable[position <= 0 ? focusable.length - 1 : position - 1]
        : focusable[position < 0 || position === focusable.length - 1 ? 0 : position + 1];
      target?.focus();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  close.addEventListener("click", hide);
  previous.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  // A click on the dark area around the screenshot closes, like most image viewers. It has
  // to start there too: a swipe that begins on the image and ends beside it is no click.
  const isBackdrop = (target: EventTarget | null) => target === stage || target === element || target === bar;
  let pressedOnBackdrop = false;
  element.addEventListener("pointerdown", (event) => {
    pressedOnBackdrop = isBackdrop(event.target);
  });
  element.addEventListener("click", (event) => {
    if (pressedOnBackdrop && isBackdrop(event.target)) hide();
    pressedOnBackdrop = false;
  });

  let swipe: { id: number; x: number; y: number } | undefined;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target !== image) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  stage.addEventListener("pointerup", (event) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = undefined;
    if (shots.length > 1 && Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      show(current + (dx < 0 ? 1 : -1));
    }
  });
  stage.addEventListener("pointercancel", () => {
    swipe = undefined;
  });

  return {
    element,
    open(index, from) {
      opener = from;
      show(index);
      if (element.hidden) {
        element.hidden = false;
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        document.addEventListener("keydown", onKey, true);
      }
      close.focus();
    },
  };
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
.mdb-landing__description p,.mdb-landing__description ul,.mdb-landing__description ol{margin:0 0 12px}
.mdb-landing__description ul,.mdb-landing__description ol{padding-left:22px}
.mdb-landing__description li+li{margin-top:4px}
.mdb-landing__description h2{margin:20px 0 8px;font-size:17px}
.mdb-landing__description code{font:.92em ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 5px;border-radius:5px;background:var(--line)}
.mdb-landing__description a,.mdb-landing__meta a{color:var(--accent)}
.mdb-landing__shots-title{margin:32px 0 12px;font-size:15px;color:var(--muted);font-weight:600}
.mdb-landing__shots{display:grid;grid-auto-flow:column;grid-auto-columns:min(78%,420px);gap:16px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x mandatory}
.mdb-landing__shot{margin:0;scroll-snap-align:start}
.mdb-landing__shot-open{display:block;width:100%;padding:0;border:0;background:none;border-radius:14px;cursor:zoom-in}
.mdb-landing__shot-open:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.mdb-landing__shot img{width:100%;border-radius:14px;border:1px solid var(--line);display:block;transition:transform .2s ease,box-shadow .2s ease}
@media (hover:hover){.mdb-landing__shot-open:hover img{transform:translateY(-2px);box-shadow:0 12px 28px rgba(15,23,42,.16)}}
.mdb-landing__shot figcaption{margin-top:8px;font-size:13px;color:var(--muted)}
.mdb-landing__lightbox{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:rgba(8,11,20,.96);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#f2f4f9;
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:mdb-landing-fade .18s ease}
.mdb-landing__lightbox[hidden]{display:none}
@keyframes mdb-landing-fade{from{opacity:0}}
.mdb-landing__lightbox-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;padding-top:max(12px,env(safe-area-inset-top))}
.mdb-landing__lightbox-count{font-size:14px;color:#aab2c5;font-variant-numeric:tabular-nums}
.mdb-landing__lightbox-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 72px;touch-action:pan-y pinch-zoom;user-select:none;-webkit-user-select:none}
.mdb-landing__lightbox-stage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,.5);transition:transform .2s ease,opacity .2s ease;-webkit-user-drag:none}
.mdb-landing__lightbox-caption{margin:0 auto;max-width:880px;padding:16px 24px;padding-bottom:max(20px,env(safe-area-inset-bottom));text-align:center;font-size:15px;color:#dfe3ec;min-height:1.5em}
.mdb-landing__lightbox button{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:999px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;transition:background .15s ease}
.mdb-landing__lightbox button:hover{background:rgba(255,255,255,.2)}
.mdb-landing__lightbox button:focus-visible{outline:3px solid #8fb0ff;outline-offset:2px}
.mdb-landing__lightbox button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mdb-landing__lightbox-prev,.mdb-landing__lightbox-next{position:absolute;top:50%;transform:translateY(-50%)}
.mdb-landing__lightbox-prev{left:12px}
.mdb-landing__lightbox-next{right:12px}
@media (max-width:560px){.mdb-landing__lightbox-stage{padding:0 8px}.mdb-landing__lightbox-prev,.mdb-landing__lightbox-next{top:auto;bottom:-56px;transform:none}.mdb-landing__lightbox-prev{left:16px}.mdb-landing__lightbox-next{right:16px}.mdb-landing__lightbox-caption{padding-left:72px;padding-right:72px;font-size:14px}}
@media (prefers-reduced-motion:reduce){.mdb-landing__lightbox,.mdb-landing__lightbox-stage img,.mdb-landing__shot img{animation:none;transition:none}}
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
  const pageLocale = resolveHavenAppLandingLocale(locale);
  const strings: LandingStrings = HAVEN_APP_LANDING_STRINGS[pageLocale];
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
  root.lang = pageLocale;
  root.dataset.testid = "haven-app-landing";
  const card = el("article", "mdb-landing__card");
  root.append(card);

  const head = el("header", "mdb-landing__head");
  // Without `listing.icon`, try the workspace icon files the starter template ships at
  // the app root, so apps built before the listing existed still show their icon.
  const iconCandidates = (listing?.icon ? [listing.icon] : [...APP_ICON_FALLBACKS])
    .map((path) => resolveMindooDBAppListingAssetUrl(path, appUrl))
    .filter((url): url is string => Boolean(url));
  if (iconCandidates.length) {
    const icon = el("img", "mdb-landing__icon");
    let next = 0;
    icon.alt = "";
    icon.addEventListener("error", () => {
      next += 1;
      if (next < iconCandidates.length) {
        icon.src = iconCandidates[next]!;
      } else {
        icon.remove();
      }
    });
    icon.src = iconCandidates[0]!;
    head.append(icon);
  }
  const titles = el("div");
  titles.append(el("p", "mdb-landing__eyebrow", strings.eyebrow), el("h1", "mdb-landing__title", label));
  const meta = el("p", "mdb-landing__meta");
  if (listing?.publisher) {
    // The origin always stays next to the name: it is the one thing the publisher
    // cannot choose freely.
    const [before, after = ""] = strings.by.split("{publisher}");
    const name = listing.publisher.url
      ? Object.assign(externalLink(listing.publisher.url), { textContent: listing.publisher.name })
      : listing.publisher.name;
    meta.append(before ?? "", name, after, " · ");
  }
  meta.append(format(strings.from, { origin }));
  titles.append(meta);
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

  const descriptionMarkdown = resolveMindooDBAppLocalizedText(listing?.descriptionMarkdown, locale);
  const description = resolveMindooDBAppLocalizedText(listing?.description, locale);
  if (descriptionMarkdown || description) {
    const block = el("section", "mdb-landing__description");
    if (descriptionMarkdown) {
      renderMarkdownDescription(block, descriptionMarkdown);
    } else {
      for (const paragraph of description.split(/\n\s*\n/)) {
        if (paragraph.trim()) block.append(el("p", undefined, paragraph.trim()));
      }
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
    const lightbox = createScreenshotLightbox(screenshots, strings);
    screenshots.forEach((shot, index) => {
      const figure = el("figure", "mdb-landing__shot");
      const open = el("button", "mdb-landing__shot-open");
      open.type = "button";
      open.setAttribute("aria-label", format(strings.enlargeShot, { number: String(index + 1) }));
      open.setAttribute("aria-haspopup", "dialog");
      open.addEventListener("click", () => lightbox.open(index, open));
      const image = el("img");
      image.src = shot.url;
      image.alt = shot.caption;
      image.loading = "lazy";
      open.append(image);
      figure.append(open);
      if (shot.caption) figure.append(el("figcaption", undefined, shot.caption));
      strip.append(figure);
    });
    card.append(strip);
    root.append(lightbox.element);
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
