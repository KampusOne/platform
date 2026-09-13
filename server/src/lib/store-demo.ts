export type DemoStoreSeller = {
  id: string;
  display_name: string;
  description: string;
  category: string;
  is_demo: true;
};

export type DemoStoreProduct = {
  id: string;
  vendor_profile_id: string;
  name: string;
  description: string;
  category: string;
  price_kobo: number;
  stock_quantity: number;
  image_url: null;
  preparation_minutes: number;
  vendor_name: string;
  rating: number;
  review_count: number;
  is_demo: true;
};

const campusCornerId = "d3a00000-0000-4000-8000-000000000001";
const hostelSupplyId = "d3a00000-0000-4000-8000-000000000002";
const campusCornerName = "Campus Corner";
const hostelSupplyName = "Hostel Supply Co.";

const sellers: DemoStoreSeller[] = [
  {
    id: campusCornerId,
    display_name: campusCornerName,
    description: "Study supplies and everyday campus essentials.",
    category: "Campus essentials",
    is_demo: true,
  },
  {
    id: hostelSupplyId,
    display_name: hostelSupplyName,
    description: "Practical room, power, and study accessories.",
    category: "Hostel essentials",
    is_demo: true,
  },
];

const products: DemoStoreProduct[] = [
  {
    id: "d3b00000-0000-4000-8000-000000000001",
    vendor_profile_id: campusCornerId,
    name: "A4 Hardback Notebook",
    description: "A ruled 160-page notebook for lectures and revision.",
    category: "Stationery",
    price_kobo: 320_000,
    stock_quantity: 24,
    image_url: null,
    preparation_minutes: 10,
    vendor_name: campusCornerName,
    rating: 4.8,
    review_count: 18,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000002",
    vendor_profile_id: campusCornerId,
    name: "Scientific Calculator",
    description: "A non-programmable calculator for classes and exams.",
    category: "Academic tech",
    price_kobo: 1_550_000,
    stock_quantity: 11,
    image_url: null,
    preparation_minutes: 10,
    vendor_name: campusCornerName,
    rating: 4.9,
    review_count: 27,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000003",
    vendor_profile_id: campusCornerId,
    name: "USB-C Fast-Charge Cable",
    description: "A durable 1.5-metre braided charging cable.",
    category: "Electronics",
    price_kobo: 450_000,
    stock_quantity: 17,
    image_url: null,
    preparation_minutes: 10,
    vendor_name: campusCornerName,
    rating: 4.6,
    review_count: 14,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000004",
    vendor_profile_id: campusCornerId,
    name: "Insulated Water Bottle",
    description: "A 750ml leak-resistant bottle for long campus days.",
    category: "Hostel essentials",
    price_kobo: 680_000,
    stock_quantity: 20,
    image_url: null,
    preparation_minutes: 10,
    vendor_name: campusCornerName,
    rating: 4.7,
    review_count: 21,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000005",
    vendor_profile_id: hostelSupplyId,
    name: "20,000mAh Power Bank",
    description: "Dual-output backup power with a battery-level display.",
    category: "Electronics",
    price_kobo: 2_750_000,
    stock_quantity: 8,
    image_url: null,
    preparation_minutes: 15,
    vendor_name: hostelSupplyName,
    rating: 4.8,
    review_count: 32,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000006",
    vendor_profile_id: hostelSupplyId,
    name: "5-Way Extension Box",
    description: "A surge-protected extension box with a two-metre cable.",
    category: "Hostel essentials",
    price_kobo: 850_000,
    stock_quantity: 13,
    image_url: null,
    preparation_minutes: 15,
    vendor_name: hostelSupplyName,
    rating: 4.7,
    review_count: 19,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000007",
    vendor_profile_id: hostelSupplyId,
    name: "Waterproof Mattress Protector",
    description: "A washable single-bed protector for hostel mattresses.",
    category: "Hostel essentials",
    price_kobo: 950_000,
    stock_quantity: 9,
    image_url: null,
    preparation_minutes: 15,
    vendor_name: hostelSupplyName,
    rating: 4.5,
    review_count: 12,
    is_demo: true,
  },
  {
    id: "d3b00000-0000-4000-8000-000000000008",
    vendor_profile_id: hostelSupplyId,
    name: "Rechargeable Study Lamp",
    description: "A dimmable desk lamp with a flexible neck and USB charging.",
    category: "Hostel essentials",
    price_kobo: 1_200_000,
    stock_quantity: 15,
    image_url: null,
    preparation_minutes: 15,
    vendor_name: hostelSupplyName,
    rating: 4.8,
    review_count: 25,
    is_demo: true,
  },
];

type DemoStoreFilters = {
  category?: string | undefined;
  query?: string | undefined;
};

export function demoStoreCatalogue(filters: DemoStoreFilters = {}) {
  const category = filters.category?.trim().toLowerCase();
  const query = filters.query?.trim().toLowerCase();
  const matchingProducts = products.filter((product) => {
    const matchesCategory = !category || product.category.toLowerCase() === category;
    const searchable = `${product.name} ${product.description} ${product.category} ${product.vendor_name}`.toLowerCase();
    return matchesCategory && (!query || searchable.includes(query));
  });
  const matchingSellerIds = new Set(matchingProducts.map((product) => product.vendor_profile_id));

  return {
    products: matchingProducts.map((product) => ({ ...product })),
    sellers: sellers.filter((seller) => matchingSellerIds.has(seller.id)).map((seller) => ({ ...seller })),
  };
}
