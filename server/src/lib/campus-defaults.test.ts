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

  it("ships a broad Ugbowo starter map with unique valid coordinates", () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    expect(UNIBEN_UGBOWO_STARTER.places.length).toBeGreaterThanOrEqual(90);

    for (const place of UNIBEN_UGBOWO_STARTER.places) {
      expect(ids.has(place.id)).toBe(false);
      ids.add(place.id);

      const normalizedName = place.name.trim().toLowerCase();
      expect(names.has(normalizedName)).toBe(false);
      names.add(normalizedName);

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

  it("includes the student-companion landmarks reconstructed from the map set", () => {
    const names = new Set(UNIBEN_UGBOWO_STARTER.places.map((place) => place.name));
    for (const expected of [
      "Main Gate",
      "John Harris Library",
      "UNIBEN International ICT Centre",
      "Hall 1 Hostel",
      "Hall 2 Hostel",
      "Hall 3 Hostel",
      "Hall 4 Hostel",
      "Keystone Hostel",
      "UNIBEN Sports Complex",
      "Food Court (Buka)",
      "University of Benin Health Centre",
      "Faculty of Arts",
      "Central Research Laboratory",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("filters by category, canonical name, and student search aliases", () => {
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

    expect(
      filterCampusStarterPlaces(UNIBEN_UGBOWO_STARTER.places, {
        query: "GTB",
      }).map((place) => place.name),
    ).toContain("Guaranty Trust Bank - UNIBEN");

    expect(
      filterCampusStarterPlaces(UNIBEN_UGBOWO_STARTER.places, {
        query: "Queen Idia",
      }).map((place) => place.name),
    ).toContain("Hall 1 Hostel");
  });
});
