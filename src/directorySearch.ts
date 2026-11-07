import { abbreviateCanonicalName, expandAbbreviatedName } from "./canonicalNames";
import type {
  MindooDBAppDirectoryPerson,
  MindooDBAppMailAddresses,
  MindooDBAppMailGateway,
  MindooDBAppMailGatewayConfig,
  MindooDBAppSearchUsersOptions,
} from "./types";

/** Default and maximum number of results of `directory.searchUsers({ … })`. */
export const SEARCH_USERS_DEFAULT_LIMIT = 20;
export const SEARCH_USERS_MAX_LIMIT = 100;

function words(value: string | undefined): string[] {
  return (value ?? "")
    .toLocaleLowerCase()
    .split(/[\s/,.;()<>"'-]+/)
    .filter(Boolean);
}

/** What a person is shown as: first and last name, display name, else the common name. */
function personLabel(person: MindooDBAppDirectoryPerson): string {
  const full = [person.firstName?.trim(), person.lastName?.trim()].filter(Boolean).join(" ");
  return full || person.displayName?.trim() || abbreviateCanonicalName(person.username).split("/")[0] || person.username;
}

/**
 * How well `person` matches `query`, or `null` for no match. Every word of the
 * query must occur, case-insensitively, in the username (canonical or
 * abbreviated), the first, last or display name. A word that starts a name
 * part counts more than one inside it, and a query that starts the full name
 * counts most, so "kar leh" puts Karsten Lehmann before Erika Karleh.
 */
export function directoryPersonMatchScore(
  person: MindooDBAppDirectoryPerson,
  query: string,
): number | null {
  const needles = words(query);
  if (!needles.length) return null;
  const abbreviated = abbreviateCanonicalName(person.username);
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ");
  const fields = [person.username, abbreviated, person.firstName, person.lastName, person.displayName, fullName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLocaleLowerCase());
  // `cn=Jane`/`o=Acme`: the key is not part of the name
  const tokens = [...new Set(fields.flatMap((field) => words(field)))].map((token) => token.replace(/^[a-z]+=/, ""));
  let score = 0;
  for (const needle of needles) {
    if (tokens.some((token) => token.startsWith(needle))) {
      score += 3;
    } else if (fields.some((field) => field.includes(needle))) {
      score += 1;
    } else {
      return null;
    }
  }
  const phrase = query.trim().toLocaleLowerCase();
  const labels = [fullName, person.displayName, abbreviated]
    .filter((value): value is string => !!value)
    .map((value) => value.toLocaleLowerCase());
  if (labels.some((label) => label === phrase)) score += 10;
  else if (labels.some((label) => label.startsWith(phrase))) score += 5;
  return score;
}

/**
 * Searches people by name and username, best matches first, then by name.
 * The reference for hosts implementing `directory.searchUsers`; the mock host
 * and the client fallback for older hosts use it.
 */
export function searchDirectoryPeople(
  people: readonly MindooDBAppDirectoryPerson[],
  options: MindooDBAppSearchUsersOptions,
): MindooDBAppDirectoryPerson[] {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? SEARCH_USERS_DEFAULT_LIMIT)),
    SEARCH_USERS_MAX_LIMIT,
  );
  const query = typeof options.query === "string" ? options.query : "";
  return people
    .map((person) => ({ person, score: directoryPersonMatchScore(person, query) }))
    .filter((entry): entry is { person: MindooDBAppDirectoryPerson; score: number } => entry.score !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        personLabel(left.person).localeCompare(personLabel(right.person)) ||
        left.person.username.localeCompare(right.person.username),
    )
    .slice(0, limit)
    .map((entry) => ({ ...entry.person }));
}

const canonicalKey = (username: string) => expandAbbreviatedName(username.trim()).toLowerCase();

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : "";
}

/** One configuration with the gateway's rules applied; addresses by lower-cased canonical username. */
interface ResolvedGateway {
  gatewayUsername: string;
  domains: string[];
  addressesByUser: Map<string, string[]>;
}

/**
 * Applies the gateway's own rules (mindoomail-gateway docs/config-and-outbox.md
 * §1): usernames canonical, addresses and domains lower-cased, addresses
 * outside the gateway's domains and addresses listed for two people left out.
 * Configurations without a gateway username or domains are skipped.
 */
function resolveGateways(configs: readonly MindooDBAppMailGatewayConfig[]): ResolvedGateway[] {
  const gateways: ResolvedGateway[] = [];
  for (const config of configs) {
    const gatewayUsername = typeof config.gatewayUsername === "string" ? config.gatewayUsername.trim() : "";
    const domains = [
      ...new Set(
        (Array.isArray(config.domains) ? config.domains : [])
          .filter((domain): domain is string => typeof domain === "string")
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (!gatewayUsername || !domains.length) continue;
    const owners = new Map<string, Set<string>>();
    for (const user of Array.isArray(config.users) ? config.users : []) {
      const username = typeof user?.username === "string" ? user.username.trim() : "";
      if (!username) continue;
      const key = canonicalKey(username);
      for (const raw of Array.isArray(user.addresses) ? user.addresses : []) {
        if (typeof raw !== "string") continue;
        const address = raw.trim().toLowerCase();
        if (!address.includes("@") || !domains.includes(domainOf(address))) continue;
        if (!owners.has(address)) owners.set(address, new Set());
        owners.get(address)!.add(key);
      }
    }
    const addressesByUser = new Map<string, string[]>();
    for (const [address, claimedBy] of owners) {
      if (claimedBy.size !== 1) continue;
      const [key] = claimedBy;
      if (!addressesByUser.has(key!)) addressesByUser.set(key!, []);
      addressesByUser.get(key!)!.push(address);
    }
    gateways.push({ gatewayUsername: expandAbbreviatedName(gatewayUsername), domains, addressesByUser });
  }
  return gateways;
}

/**
 * What `directory.mailGateways()` answers for the configuration documents of a
 * tenant, as seen by `currentUsername`: per gateway its username, domains, the
 * current user's own addresses, and whether it is the default (the first that
 * gives the user an address, else the first one). No other member's addresses:
 * those come one person at a time from {@link mailAddressesFromConfigs}.
 */
export function mailGatewaysFromConfigs(
  configs: readonly MindooDBAppMailGatewayConfig[],
  currentUsername: string,
): MindooDBAppMailGateway[] {
  const me = currentUsername ? canonicalKey(currentUsername) : "";
  const gateways: MindooDBAppMailGateway[] = resolveGateways(configs).map((gateway) => ({
    gatewayUsername: gateway.gatewayUsername,
    domains: gateway.domains,
    ownAddresses: me ? [...(gateway.addressesByUser.get(me) ?? [])] : [],
    isDefault: false,
  }));
  const preferred = gateways.find((gateway) => gateway.ownAddresses.length > 0) ?? gateways[0];
  if (preferred) preferred.isDefault = true;
  return gateways;
}

/**
 * What `directory.mailAddressesFor(usernames)` answers: one entry per username
 * asked for, in that order, with the username as given. `addresses` collects
 * the person's addresses at every gateway (in gateway order, the first per
 * gateway being its primary), empty when no gateway lists the person.
 */
export function mailAddressesFromConfigs(
  configs: readonly MindooDBAppMailGatewayConfig[],
  usernames: readonly string[],
): MindooDBAppMailAddresses[] {
  const gateways = resolveGateways(configs);
  return usernames.map((username) => {
    const key = canonicalKey(username);
    const addresses = [...new Set(gateways.flatMap((gateway) => gateway.addressesByUser.get(key) ?? []))];
    return { username, addresses };
  });
}
