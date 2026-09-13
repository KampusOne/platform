import { describe, expect, it } from "vitest";

import { demoStoreCatalogue } from "./store-demo";

describe("demo store catalogue", () => {
  it("provides a deterministic read-only catalogue with two sellers", () => {
    const catalogue = demoStoreCatalogue();

    expect(catalogue.sellers).toHaveLength(2);
    expect(catalogue.products).toHaveLength(8);
    expect(new Set(catalogue.products.map((product) => product.vendor_profile_id))).toEqual(
      new Set(catalogue.sellers.map((seller) => seller.id)),
    );
    expect(catalogue.products.every((product) => product.is_demo && product.image_url === null)).toBe(true);
  });

  it("filters products by category without leaking unrelated sellers", () => {
    const catalogue = demoStoreCatalogue({ category: "Academic tech" });

    expect(catalogue.products.map((product) => product.name)).toEqual(["Scientific Calculator"]);
    expect(catalogue.sellers.map((seller) => seller.display_name)).toEqual(["Campus Corner"]);
  });

  it("searches product and seller text case-insensitively", () => {
    const byProduct = demoStoreCatalogue({ query: "LAMP" });
    const bySeller = demoStoreCatalogue({ query: "hostel supply" });

    expect(byProduct.products.map((product) => product.name)).toEqual(["Rechargeable Study Lamp"]);
    expect(bySeller.products).toHaveLength(4);
    expect(bySeller.sellers.map((seller) => seller.display_name)).toEqual(["Hostel Supply Co."]);
  });
});
