#!/usr/bin/env node
/**
 * Draws the link preview image of a Haven app: 1200×630 PNG with the app icon, the app
 * name and the first store screenshot, and records it as `listing.shareImage` in
 * `public/haven-app.json`. `havenBundle()` then writes `og:image` and a large
 * `twitter:card` into `index.html`, so Messages, Slack, X and others show the image when
 * the app's address is shared.
 *
 *   npx -p playwright@1 -p mindoodb-app-sdk mindoodb-share-image [appDir]
 *       [--screenshot <n>]   which listing screenshot to show, 1 = first (default), 0 = none
 *       [--out <path>]       relative to public/, default listing/share.png
 *       [--no-manifest]      only draw the image, leave haven-app.json alone
 *
 * The image holds no sentences, only the app name and "MindooDB Haven", so one image
 * serves every language. The localized text of a preview is og:description.
 *
 * Needs Playwright with Chromium (`npx playwright install chromium` once).
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WIDTH = 1200;
const HEIGHT = 630;
const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(here, "..", "share-image", "fonts");

const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

function parseArgs(argv) {
  const options = { appDir: ".", screenshot: 1, out: "listing/share.png", manifest: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--screenshot") options.screenshot = Number(argv[++i]);
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--no-manifest") options.manifest = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else options.appDir = arg;
  }
  if (!Number.isInteger(options.screenshot) || options.screenshot < 0) {
    throw new Error("--screenshot must be 0 or a positive number");
  }
  return options;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function dataUrl(file) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type: ${file}`);
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
}

/** A listing path on the app origin → the file under public/. Absolute URLs are not fetched. */
function publicFile(publicDir, asset) {
  if (typeof asset !== "string" || !asset.trim() || /^[a-z][a-z0-9+.-]*:/i.test(asset) || asset.startsWith("//")) {
    return undefined;
  }
  return path.join(publicDir, asset.trim().replace(/^\.?\//, ""));
}

async function findIcon(publicDir, listing) {
  const candidates = [publicFile(publicDir, listing?.icon)];
  for (const ext of ["png", "webp", "svg", "jpg"]) candidates.push(path.join(publicDir, `appicon.${ext}`));
  for (const file of candidates) {
    if (file && (await exists(file))) return file;
  }
  return undefined;
}

async function loadPlaywright(appDir) {
  // The app's own Playwright first, then one next to this SDK (npx -p playwright).
  for (const base of [path.join(appDir, "package.json"), fileURLToPath(import.meta.url)]) {
    const require = createRequire(base);
    for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
      try {
        const mod = await import(pathToFileURL(require.resolve(name)).href);
        if (mod.chromium) return mod;
        if (mod.default?.chromium) return mod.default;
      } catch {
        // try the next one
      }
    }
  }
  throw new Error(
    "Playwright not found. Run with `npx -p playwright@1 -p mindoodb-app-sdk mindoodb-share-image`, " +
      "or add @playwright/test to the app.",
  );
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pageHtml({ title, icon, screenshot, fonts }) {
  const layout = screenshot ? "with-shot" : "no-shot";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Figtree;font-weight:300 900;src:url(${fonts.latin}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Figtree;font-weight:300 900;src:url(${fonts.latinExt}) format("woff2");unicode-range:U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
*{box-sizing:border-box;margin:0}
html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
body{position:relative;background:#1f3a8a;color:#fff;font-family:Figtree,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.text{position:absolute;left:72px;top:0;bottom:0;width:440px;display:flex;flex-direction:column;justify-content:center;gap:28px}
.icon{width:120px;height:120px;border-radius:26px;object-fit:cover;display:block}
.icon.plate{background:#fff;padding:14px;object-fit:contain}
.icon.ring{outline:3px solid rgba(255,255,255,.45)}
h1{font-size:64px;line-height:1.04;font-weight:700;letter-spacing:-.015em;overflow-wrap:normal}
h1.squeezed{overflow-wrap:anywhere}
.brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600;color:#c9d5f7;letter-spacing:.01em}
.brand::before{content:"";width:32px;height:3px;background:#8fb0ff}
.shot{position:absolute;display:block;border:1px solid rgba(255,255,255,.28);border-radius:4px;background:#fff}
.shot.wide{left:560px;top:84px;width:720px;height:auto;border-right:0}
.shot.tall{top:56px;height:640px;width:auto;border-bottom:0}
.no-shot .text{left:0;right:0;width:auto;align-items:center;text-align:center}
.no-shot h1{max-width:960px}
.no-shot .icon{width:168px;height:168px;border-radius:36px}
.no-shot .icon.plate{padding:20px}
</style></head><body class="${layout}">
<div class="text">
${icon ? `<img class="icon" src="${icon}" alt="">` : ""}
<h1 id="title">${escapeHtml(title)}</h1>
<div class="brand">MindooDB Haven</div>
</div>
${screenshot ? `<img class="shot" id="shot" src="${screenshot}" alt="">` : ""}
<script>
window.__layout = async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  // An icon that is only a shape on a transparent background (no tile of its own) gets
  // a white tile, so a dark shape does not disappear on the blue. A tile in about the
  // background's own blue gets a light ring, so its edge stays visible.
  const icon = document.querySelector(".icon");
  if (icon && icon.naturalWidth) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(icon, 0, 0, 64, 64);
    const alpha = ctx.getImageData(0, 0, 64, 64).data;
    let covered = 0;
    for (let i = 3; i < alpha.length; i += 4) if (alpha[i] > 200) covered++;
    if (covered / (64 * 64) < 0.7) {
      icon.classList.add("plate");
    } else {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 8; y < 56; y++) {
        for (const x of [8, 55]) {
          const i = (y * 64 + x) * 4;
          r += alpha[i]; g += alpha[i + 1]; b += alpha[i + 2]; n++;
        }
      }
      const distance = Math.hypot(r / n - 0x1f, g / n - 0x3a, b / n - 0x8a);
      if (distance < 60) icon.classList.add("ring");
    }
  }
  const shot = document.getElementById("shot");
  if (shot) {
    if (shot.naturalHeight > shot.naturalWidth) {
      // A phone screenshot: stand it up on the right, cut off at the bottom edge.
      shot.classList.add("tall");
      const width = 640 * shot.naturalWidth / shot.naturalHeight;
      shot.style.left = Math.round(560 + (${WIDTH} - 560 - width) / 2) + "px";
    } else {
      shot.classList.add("wide");
    }
  }
  // Long names: shrink until the longest word fits and the name takes at most three lines.
  const title = document.getElementById("title");
  let size = 64;
  const fits = () => title.scrollWidth <= title.clientWidth + 1 && title.getBoundingClientRect().height <= size * 1.04 * 3 + 2;
  while (size > 36 && !fits()) {
    size -= 2;
    title.style.fontSize = size + "px";
  }
  if (!fits()) title.classList.add("squeezed");
  return true;
};
</script></body></html>`;
}

/** Sets listing.shareImage without rewriting the rest of the file. */
function withShareImage(text, value) {
  const json = JSON.stringify(value);
  if (/"shareImage"\s*:\s*"[^"]*"/.test(text)) {
    return text.replace(/"shareImage"\s*:\s*"[^"]*"/, `"shareImage": ${json}`);
  }
  const listing = /^([ \t]*)"listing"\s*:\s*\{[ \t]*\r?\n([ \t]*)/m.exec(text);
  if (!listing) return undefined;
  const at = listing.index + listing[0].length;
  return `${text.slice(0, at)}"shareImage": ${json},\n${listing[2]}${text.slice(at)}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("mindoodb-share-image [appDir] [--screenshot <n>] [--out <path>] [--no-manifest]");
    return;
  }
  const appDir = path.resolve(options.appDir);
  const publicDir = path.join(appDir, "public");
  const manifestFile = path.join(publicDir, "haven-app.json");
  const manifestText = await readFile(manifestFile, "utf8");
  const manifest = JSON.parse(manifestText);
  const listing = manifest.listing ?? {};
  const title = typeof manifest.label === "string" && manifest.label.trim() ? manifest.label.trim() : undefined;
  if (!title) throw new Error(`${manifestFile} has no label`);

  const iconFile = await findIcon(publicDir, listing);
  const shots = Array.isArray(listing.screenshots) ? listing.screenshots : [];
  const shotEntry = options.screenshot > 0 ? shots[options.screenshot - 1] : undefined;
  const shotFile = publicFile(publicDir, typeof shotEntry === "string" ? shotEntry : shotEntry?.file);

  const html = pageHtml({
    title,
    icon: iconFile ? await dataUrl(iconFile) : undefined,
    screenshot: shotFile && (await exists(shotFile)) ? await dataUrl(shotFile) : undefined,
    fonts: {
      latin: `data:font/woff2;base64,${(await readFile(path.join(fontsDir, "Figtree-latin-wght-normal.woff2"))).toString("base64")}`,
      latinExt: `data:font/woff2;base64,${(await readFile(path.join(fontsDir, "Figtree-latin-ext-wght-normal.woff2"))).toString("base64")}`,
    },
  });

  const { chromium } = await loadPlaywright(appDir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => window.__layout());
    const outFile = path.join(publicDir, options.out);
    await mkdir(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile, type: "png" });
    console.log(`[share-image] ${path.relative(appDir, outFile)} (${WIDTH}×${HEIGHT})` +
      `${iconFile ? "" : ", no icon found"}${shotFile ? "" : ", no screenshot"}`);
  } finally {
    await browser.close();
  }

  if (options.manifest) {
    const shareImage = options.out.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (listing.shareImage !== shareImage) {
      const updated = withShareImage(manifestText, shareImage);
      if (!updated) {
        console.warn(`[share-image] add "shareImage": "${shareImage}" to listing in ${manifestFile} yourself`);
      } else {
        await writeFile(manifestFile, updated);
        console.log(`[share-image] listing.shareImage = ${shareImage}`);
      }
    }
    if (!manifest.publicUrl) {
      console.warn(
        "[share-image] haven-app.json has no publicUrl: without it a production build writes no share tags at all.",
      );
    }
  }
}

main().catch((error) => {
  console.error(`[share-image] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
