/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { MINDOODB_APP_DEFINITION_FORMAT, MINDOODB_APP_DEFINITION_VERSION } from "./appDefinition";
import { buildHavenAppInstallUrl, renderHavenAppLandingPage, resolveCurrentHavenAppUrl } from "./landing";

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
});
