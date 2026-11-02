import { describe, expect, it } from "vitest";

import { havenAppShareMeta, injectHavenAppShareMeta, renderHavenAppShareMeta } from "./shareMeta";

const definition = {
  label: 'Vega "trips"',
  description: "Fallback.",
  listing: {
    summary: { en: "Plan trips together.", de: "Reisen planen." },
    description: { en: "Longer text." },
    icon: "listing/icon.webp",
  },
};

describe("havenAppShareMeta", () => {
  it("uses the English summary and an absolute icon URL", () => {
    expect(havenAppShareMeta(definition, "https://app-vega.mindoodb.com")).toEqual({
      title: 'Vega "trips"',
      description: "Plan trips together.",
      pageUrl: "https://app-vega.mindoodb.com/",
      imageUrl: "https://app-vega.mindoodb.com/listing/icon.webp",
      imageKind: "icon",
    });
  });

  it("prefers listing.shareImage over the icon", () => {
    const meta = havenAppShareMeta(
      { ...definition, listing: { ...definition.listing, shareImage: "listing/share.png" } },
      "https://app-vega.mindoodb.com",
    );
    expect(meta?.imageUrl).toBe("https://app-vega.mindoodb.com/listing/share.png");
    expect(meta?.imageKind).toBe("wide");
  });

  it("falls back to the icon when the share image is an SVG", () => {
    const meta = havenAppShareMeta(
      { ...definition, listing: { ...definition.listing, shareImage: "listing/share.svg" } },
      "https://app-vega.mindoodb.com",
    );
    expect(meta?.imageKind).toBe("icon");
  });

  it("keeps an icon that is already an absolute URL and drops SVG", () => {
    expect(
      havenAppShareMeta(
        { label: "App", listing: { icon: "https://cdn.example/icon.png" } },
        "https://app.example/",
      )?.imageUrl,
    ).toBe("https://cdn.example/icon.png");
    expect(
      havenAppShareMeta({ label: "App", listing: { icon: "listing/icon.svg" } }, "https://app.example/")?.imageUrl,
    ).toBeUndefined();
  });

  it("refuses a page URL that is not http(s)", () => {
    expect(havenAppShareMeta(definition, "javascript:alert(1)")).toBeUndefined();
  });
});

describe("renderHavenAppShareMeta", () => {
  it("writes a summary card and escapes the title", () => {
    const html = renderHavenAppShareMeta({
      title: 'Vega "trips"',
      description: "Plan trips.",
      pageUrl: "https://app-vega.mindoodb.com/",
      imageUrl: "https://app-vega.mindoodb.com/listing/icon.webp",
    });
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).toContain('<meta property="og:title" content="Vega &quot;trips&quot;">');
    expect(html).toContain('<meta name="twitter:image" content="https://app-vega.mindoodb.com/listing/icon.webp">');
    expect(html).not.toContain("summary_large_image");
    expect(html).not.toContain("og:image:width");
    expect(html).toContain('<meta property="og:site_name" content="MindooDB Haven">');
  });

  it("writes a large card with the image size for a share image", () => {
    const html = renderHavenAppShareMeta({
      title: "Invoice",
      description: "Write invoices.",
      pageUrl: "https://app-invoice.mindoodb.com/",
      imageUrl: "https://app-invoice.mindoodb.com/listing/share.png",
      imageKind: "wide",
    });
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:image" content="https://app-invoice.mindoodb.com/listing/share.png">');
  });
});

describe("injectHavenAppShareMeta", () => {
  const meta = {
    title: "Vega",
    description: "Plan trips.",
    pageUrl: "https://app-vega.mindoodb.com/",
    imageUrl: "https://app-vega.mindoodb.com/listing/icon.webp",
  };

  it("inserts the tags before </head> and replaces the title once", () => {
    const html = injectHavenAppShareMeta("<!doctype html><head><title>Old</title></head>", meta);
    expect(html).toContain("<title>Vega</title>");
    expect(html).not.toContain("<title>Old</title>");
    expect(html.indexOf("twitter:card")).toBeLessThan(html.toLowerCase().indexOf("</head>"));
    expect(injectHavenAppShareMeta(html, meta)).toBe(html);
  });
});
