import { describe, expect, it } from "vitest";

import { abbreviateCanonicalName, expandAbbreviatedName } from "./canonicalNames";

describe("canonicalNames", () => {
  it("abbreviates canonical Notes names", () => {
    expect(abbreviateCanonicalName("cn=abc/o=def")).toBe("abc/def");
    expect(abbreviateCanonicalName("CN=Karsten Lehmann/OU=mysuborg/O=Mindoo")).toBe("Karsten Lehmann/mysuborg/Mindoo");
    expect(abbreviateCanonicalName("CN=server1")).toBe("server1");
    expect(abbreviateCanonicalName("UID=karsten/OU=dev/O=Mindoo")).toBe("karsten/dev/Mindoo");
  });

  it("expands abbreviated Notes names to canonical form", () => {
    expect(expandAbbreviatedName("Karsten Lehmann/Mindoo")).toBe("cn=Karsten Lehmann/o=Mindoo");
    expect(expandAbbreviatedName("Karsten Lehmann/mysuborg/Mindoo"))
      .toBe("cn=Karsten Lehmann/ou=mysuborg/o=Mindoo");
    expect(expandAbbreviatedName("Karsten Lehmann/dev/eu/Mindoo"))
      .toBe("cn=Karsten Lehmann/ou=dev/ou=eu/o=Mindoo");
  });
});
