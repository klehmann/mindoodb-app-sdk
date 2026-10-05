/**
 * The Markdown subset a publisher may use in `listing.descriptionMarkdown`.
 *
 * The text comes from a file on the publisher's server and is shown before anyone has
 * agreed to install the app, so it is parsed into a small tree here and rendered with
 * `createElement`/`textContent` (or Vue render functions) — never as HTML. What the
 * subset knows:
 *
 * - paragraphs (blank lines), headings (`#`), bullet (`-`, `*`, `+`) and numbered lists
 * - `**bold**`, `__bold__`, `*italic*`, `_italic_`, `` `code` ``, `\` escapes
 * - `[text](https://…)`, `[text](mailto:…)` and bare `https://…` links
 *
 * Anything else stays literal text. Links are limited to `https:` and `mailto:` by
 * {@link sanitizeListingHref}; a link with any other target renders as its text only.
 *
 * DOM-free on purpose, so Haven, the landing page and build scripts can share it.
 */

export type ListingInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: ListingInline[] }
  | { type: "em"; children: ListingInline[] }
  | { type: "link"; href: string; children: ListingInline[] };

export type ListingBlock =
  | { type: "paragraph"; children: ListingInline[] }
  | { type: "heading"; children: ListingInline[] }
  | { type: "list"; ordered: boolean; items: ListingInline[][] };

/** Emphasis inside emphasis inside a link is plenty for a store description. */
const MAX_INLINE_DEPTH = 4;

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d{1,9}[.)]\s+(.*)$/;
const ESCAPABLE = new Set("\\`*_[]()#+-.!<>".split(""));
const BARE_URL_TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/;

/**
 * `https:` and `mailto:` only. Embedded tab/LF/CR are stripped first, as browsers do,
 * so `java\nscript:` cannot slip past the scheme check.
 */
export function sanitizeListingHref(raw: string): string | null {
  const cleaned = raw.replace(/[\t\n\r]/g, "").trim();
  if (!cleaned) {
    return null;
  }
  try {
    const url = new URL(cleaned);
    if (url.protocol === "https:") {
      return url.toString();
    }
    if (url.protocol === "mailto:" && url.pathname) {
      return url.toString();
    }
  } catch {
    // Relative or malformed: not a link.
  }
  return null;
}

function isWordCharacter(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function pushText(nodes: ListingInline[], text: string): void {
  if (!text) {
    return;
  }
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    last.text += text;
  } else {
    nodes.push({ type: "text", text });
  }
}

/**
 * An emphasis delimiter only opens when the next character is not a space, and `_`
 * only at a word boundary, so `teacher_core` and `2 * 3` stay literal.
 */
function findClosingDelimiter(text: string, from: number, delimiter: string): number {
  let index = text.indexOf(delimiter, from);
  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + delimiter.length];
    const closesAfterContent = index > from && before !== " " && before !== "\\";
    const underscoreBoundary = delimiter[0] !== "_" || !isWordCharacter(after);
    if (closesAfterContent && underscoreBoundary) {
      return index;
    }
    index = text.indexOf(delimiter, index + 1);
  }
  return -1;
}

/** End of `(url)`, balancing parentheses inside the URL; -1 when it never closes. */
function findLinkTargetEnd(text: string, from: number): number {
  let open = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      open += 1;
    } else if (char === ")") {
      if (open === 0) return index;
      open -= 1;
    } else if (char === " ") {
      return -1;
    }
  }
  return -1;
}

function parseInline(text: string, depth = 0): ListingInline[] {
  const nodes: ListingInline[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;

    if (char === "\\" && ESCAPABLE.has(text[index + 1] ?? "")) {
      pushText(nodes, text[index + 1]!);
      index += 2;
      continue;
    }

    if (char === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        nodes.push({ type: "code", text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && (char === "*" || char === "_")) {
      const strong = text[index + 1] === char;
      const delimiter = strong ? char + char : char;
      const next = text[index + delimiter.length];
      const opens = next !== undefined && next !== " " && (char !== "_" || !isWordCharacter(text[index - 1]));
      if (opens) {
        const end = findClosingDelimiter(text, index + delimiter.length, delimiter);
        if (end !== -1) {
          const children = parseInline(text.slice(index + delimiter.length, end), depth + 1);
          nodes.push(strong ? { type: "strong", children } : { type: "em", children });
          index = end + delimiter.length;
          continue;
        }
      }
    }

    if (char === "[" && depth < MAX_INLINE_DEPTH) {
      const labelEnd = text.indexOf("](", index + 1);
      const urlEnd = labelEnd === -1 ? -1 : findLinkTargetEnd(text, labelEnd + 2);
      if (labelEnd > index + 1 && urlEnd !== -1) {
        const label = parseInline(text.slice(index + 1, labelEnd), depth + 1);
        const href = sanitizeListingHref(text.slice(labelEnd + 2, urlEnd));
        if (href) {
          nodes.push({ type: "link", href, children: label });
        } else {
          nodes.push(...label);
        }
        index = urlEnd + 1;
        continue;
      }
    }

    if (char === "h" && text.startsWith("https://", index) && !isWordCharacter(text[index - 1])) {
      let end = index;
      while (end < text.length && !/\s/.test(text[end]!)) end += 1;
      const candidate = text.slice(index, end).replace(BARE_URL_TRAILING_PUNCTUATION, "");
      const href = sanitizeListingHref(candidate);
      if (href) {
        nodes.push({ type: "link", href, children: [{ type: "text", text: candidate }] });
        index += candidate.length;
        continue;
      }
    }

    pushText(nodes, char);
    index += 1;
  }
  return nodes;
}

/** Parses a description into blocks. Unknown syntax stays text; nothing is dropped. */
export function parseListingMarkdown(markdown: string): ListingBlock[] {
  const blocks: ListingBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items.map((item) => parseInline(item)) });
      list = null;
    }
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", children: parseInline(heading[1]!) });
    } else if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) {
        flushList();
      }
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((bullet ?? ordered)![1]!);
    } else if (list) {
      // A wrapped list item: the line continues the item above it.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

function inlineToPlainText(nodes: ListingInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") {
        return node.text;
      }
      const label = inlineToPlainText(node.children);
      if (node.type !== "link") {
        return label;
      }
      const target = node.href.replace(/^mailto:/, "").replace(/^https:\/\//, "").replace(/\/$/, "");
      return label.includes(target) ? label : `${label} (${node.href.replace(/^mailto:/, "")})`;
    })
    .join("");
}

/**
 * The same text for readers that only show plain paragraphs (`listing.description`):
 * one paragraph per block and per list item, links as "text (url)".
 */
export function listingMarkdownToPlainText(markdown: string): string {
  const paragraphs: string[] = [];
  for (const block of parseListingMarkdown(markdown)) {
    if (block.type === "list") {
      block.items.forEach((item, index) => {
        paragraphs.push(`${block.ordered ? `${index + 1}.` : "•"} ${inlineToPlainText(item)}`);
      });
    } else {
      paragraphs.push(inlineToPlainText(block.children));
    }
  }
  return paragraphs.filter((paragraph) => paragraph.trim()).join("\n\n");
}
