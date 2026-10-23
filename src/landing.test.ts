/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { MINDOODB_APP_DEFINITION_FORMAT, MINDOODB_APP_DEFINITION_VERSION } from "./appDefinition";
import {
  buildHavenAppInstallUrl,
  HAVEN_APP_LANDING_LOCALES,
  HAVEN_APP_LANDING_STRINGS,
  renderHavenAppLandingPage,
  resolveCurrentHavenAppUrl,
  resolveHavenAppLandingLocale,
} from "./landing";

const definition = {
  format: MINDOODB_APP_DEFINITION_FORMAT,
  formatVersion: MINDOODB_APP_DEFINITION_VERSION,
  appId: "trips",
  label: "Trip Planner",
  listing: {
    summary: { en: "Plan trips together.", de: "Reisen gemeinsam planen." },
    description: "One.\n\nTwo <b>not markup</b>.",
    icon: "icon.svg",
    screenshots: [{ file: "shots/1.png", caption: { en: "Board", de: "Tafel" } }],
    publisher: { name: "Mindoo" },
  },
};

describe("haven app landing page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("derives the app URL from the current page", () => {
    expect(resolveCurrentHavenAppUrl("https://trips.example.com/index.html?x=1#y")).toBe(
      "https://trips.example.com/",
    );
    expect(buildHavenAppInstallUrl("https://trips.example.com/")).toBe(
      "https://haven.mindoodb.com/?app=https%3A%2F%2Ftrips.example.com%2F",
    );
  });

  it("renders the listing from haven-app.json and links to Haven", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(definition), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await renderHavenAppLandingPage({
      appUrl: "https://trips.example.com/",
      havenUrl: "https://haven.example.com",
      locale: "de-DE",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://trips.example.com/haven-app.json");
    expect(page.installUrl).toBe("https://haven.example.com/?app=https%3A%2F%2Ftrips.example.com%2F");
    const root = document.querySelector('[data-testid="haven-app-landing"]')!;
    expect(root.querySelector("h1")?.textContent).toBe("Trip Planner");
    expect(root.textContent).toContain("Reisen gemeinsam planen.");
    expect(root.textContent).toContain("von Mindoo · von trips.example.com");
    expect(root.querySelector(".mdb-landing__description b")).toBeNull();
    expect(root.querySelectorAll(".mdb-landing__description p")).toHaveLength(2);
    expect(root.querySelector<HTMLImageElement>(".mdb-landing__icon")?.src).toBe(
      "https://trips.example.com/icon.svg",
    );
    expect(root.querySelector("figcaption")?.textContent).toBe("Tafel");
    expect(root.querySelector<HTMLAnchorElement>('[data-testid="haven-app-landing-install"]')?.href).toBe(
      page.installUrl,
    );
    expect(document.title).toBe("Trip Planner");
  });

  it("renders descriptionMarkdown as elements and links the publisher", async () => {
    const markdown = {
      ...definition,
      listing: {
        ...definition.listing,
        descriptionMarkdown:
          "Plan **together**, see [our site](https://mindoo.example).\n\n- one\n- two <img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))",
        publisher: { name: "Mindoo", url: "https://mindoo.example" },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(markdown), { status: 200 })));

    await renderHavenAppLandingPage({ appUrl: "https://trips.example.com/", locale: "en" });

    const section = document.querySelector(".mdb-landing__description")!;
    expect(section.querySelector("strong")?.textContent).toBe("together");
    const links = [...section.querySelectorAll("a")];
    expect(links.map((link) => link.href)).toEqual(["https://mindoo.example/"]);
    expect(links[0]?.rel).toBe("noopener noreferrer");
    expect(section.querySelectorAll("li")).toHaveLength(2);
    expect(section.querySelector("img")).toBeNull();
    expect(section.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(section.textContent).toContain("bad");
    const publisher = document.querySelector<HTMLAnchorElement>(".mdb-landing__meta a");
    expect(publisher?.textContent).toBe("Mindoo");
    expect(publisher?.href).toBe("https://mindoo.example/");
    expect(document.querySelector(".mdb-landing__meta")?.textContent).toBe("by Mindoo · from trips.example.com");
  });

  it("still offers the Haven link when haven-app.json is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const page = await renderHavenAppLandingPage({ appUrl: "https://trips.example.com/", locale: "en" });
    expect(page.definition).toBeNull();
    expect(document.querySelector<HTMLImageElement>(".mdb-landing__icon")?.src).toBe(
      "https://trips.example.com/appicon.png",
    );
    expect(document.querySelector('[data-testid="haven-app-landing-install"]')).not.toBeNull();
    expect(document.body.textContent).toContain("This app runs inside MindooDB Haven.");
  });

  it("ships every fixed text in every Haven language with the English placeholders", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
    const english = HAVEN_APP_LANDING_STRINGS.en;
    expect(Object.keys(HAVEN_APP_LANDING_STRINGS).sort()).toEqual([...HAVEN_APP_LANDING_LOCALES].sort());
    for (const locale of HAVEN_APP_LANDING_LOCALES) {
      const strings: Record<string, string> = HAVEN_APP_LANDING_STRINGS[locale];
      expect(Object.keys(strings).sort(), locale).toEqual(Object.keys(english).sort());
      for (const [key, source] of Object.entries(english)) {
        expect(strings[key]?.trim(), `${locale}.${key}`).toBeTruthy();
        expect(placeholders(strings[key]!), `${locale}.${key}`).toBe(placeholders(source));
      }
    }
  });

  it("picks the page language by primary subtag, Norwegian as Bokmål, else English", () => {
    expect(resolveHavenAppLandingLocale("fr-CA")).toBe("fr");
    expect(resolveHavenAppLandingLocale("pl")).toBe("pl");
    expect(resolveHavenAppLandingLocale("nb-NO")).toBe("nb");
    expect(resolveHavenAppLandingLocale("no")).toBe("nb");
    expect(resolveHavenAppLandingLocale("nn-NO")).toBe("nb");
    expect(resolveHavenAppLandingLocale("pt-BR")).toBe("en");
    expect(resolveHavenAppLandingLocale("")).toBe("en");
  });

  it("renders fixed texts and listing texts in the browser language", async () => {
    vi.stubGlobal("navigator", { language: "nn-NO" });
    const localized = {
      ...definition,
      listing: { ...definition.listing, summary: { en: "Plan trips together.", nb: "Planlegg turer sammen." } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(localized), { status: 200 })));
    await renderHavenAppLandingPage({ appUrl: "https://trips.example.com/" });
    const root = document.querySelector<HTMLElement>('[data-testid="haven-app-landing"]')!;
    expect(root.lang).toBe("nb");
    expect(root.querySelector('[data-testid="haven-app-landing-install"]')?.textContent).toBe("Åpne i MindooDB Haven");
    expect(root.querySelector(".mdb-landing__summary")?.textContent).toBe("Planlegg turer sammen.");
    expect(root.querySelector(".mdb-landing__meta")?.textContent).toBe("fra Mindoo · fra trips.example.com");
    expect(root.querySelector(".mdb-landing__shots-title")?.textContent).toBe("Skjermbilder");
  });
});
