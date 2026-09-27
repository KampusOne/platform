import { describe, expect, it } from "vitest";

import {
  campusDirectoryDefaultForUniversity,
  filterCampusStarterPlaces,
  UNIBEN_UGBOWO_STARTER,
} from "./campus-defaults";

describe("campus starter directory", () => {
  it("is tenant-safe and only activates for University of Benin", () => {
    expect(campusDirectoryDefaultForUniversity("University of Benin")).toBe(
      UNIBEN_UGBOWO_STARTER,
    );
    expect(campusDirectoryDefaultForUniversity("University of Lagos")).toBeNull();
  });

  it("ships a usable Ugbowo starter map with valid unique coordinates", () => {
    const ids = new Set<string>();
    expect(UNIBEN_UGBOWO_STARTER.places.length).toBeGreaterThanOrEqual(10);

    for (const place of UNIBEN_UGBOWO_STARTER.places) {
      expect(ids.has(place.id)).toBe(false);
      ids.add(place.id);

      const latitude = Number(place.latitude);
      const longitude = Number(place.longitude);
      expect(Number.isFinite(latitude)).toBe(true);
      expect(Number.isFinite(longitude)).toBe(true);
      expect(latitude).toBeGreaterThan(6.38);
      expect(latitude).toBeLessThan(6.42);
      expect(longitude).toBeGreaterThan(5.59);
      expect(longitude).toBeLessThan(5.64);
    }
  });

  it("filters the starter directory like the database endpoint", () => {
    expect(
      filterCampusStarterPlaces(UNIBEN_UGBOWO_STARTER.places, {
        category: "HOSTEL",
      }).every((place) => place.category === "HOSTEL"),
    ).toBe(true);

    expect(
      filterCampusStarterPlaces(UNIBEN_UGBOWO_STARTER.places, {
        query: "engineering",
      }).map((place) => place.name),
    ).toContain("Faculty of Engineering");
  });
});
