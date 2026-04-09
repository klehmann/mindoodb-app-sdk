const CANONICAL_PART_PATTERN = /^\s*([^=]+)\s*=\s*(.*?)\s*$/;

/** Split a Notes-style name into non-empty slash-separated segments. */
function splitNameParts(value: string) {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Convert a canonical Notes name like `cn=Jane/ou=Dev/o=Mindoo`
 * into the abbreviated form `Jane/Dev/Mindoo`.
 *
 * If the input is not a slash-separated canonical name, the trimmed
 * original value is returned unchanged.
 */
export function abbreviateCanonicalName(value: string): string {
  const parts = splitNameParts(value);
  if (!parts.length) {
    return value.trim();
  }

  const abbreviatedParts: string[] = [];
  for (const part of parts) {
    const match = CANONICAL_PART_PATTERN.exec(part);
    if (!match) {
      return value.trim();
    }
    const partValue = match[2].trim();
    if (!partValue) {
      return value.trim();
    }
    abbreviatedParts.push(partValue);
  }

  return abbreviatedParts.join("/");
}

/**
 * Convert an abbreviated Notes name like `Jane/Dev/Mindoo`
 * into canonical form `cn=Jane/ou=Dev/o=Mindoo`.
 *
 * The first segment becomes `cn=`, the last becomes `o=`, and any
 * middle segments become `ou=` parts in order. Values with fewer than
 * two segments are returned unchanged.
 */
export function expandAbbreviatedName(value: string): string {
  const parts = splitNameParts(value);
  if (parts.length < 2) {
    return value.trim();
  }

  const [commonName, ...rest] = parts;
  const organization = rest.at(-1);
  if (!commonName || !organization) {
    return value.trim();
  }

  const organizationUnits = rest.slice(0, -1);
  return [
    `cn=${commonName}`,
    ...organizationUnits.map((part) => `ou=${part}`),
    `o=${organization}`,
  ].join("/");
}
