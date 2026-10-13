import { listingPhotos } from './listing-photos';
export type SellerProduct = {
  id: string; name: string; description: string; category_id: string;
  price_kobo: number; stock_quantity: number; listing_revision: number; status: string;
  image_url: string | null; image_urls?: string[];
  preparation_minutes: number; package_weight_grams: number | null;
  package_length_cm: number | null; package_width_cm: number | null; package_height_cm: number | null;
  bicycle_delivery_eligible: boolean;
};
export function sellerProductPhotos(product: Pick<SellerProduct, 'image_urls' | 'image_url'>) {
  return listingPhotos(product.image_urls, product.image_url ?? '');
}
export function productEditMatches(product: SellerProduct, details: {
  name: string; description: string; categoryId: string; priceKobo: number; imageUrls: string[];
  stockQuantity?: number; preparationMinutes: number; packageWeightGrams: number | null;
  packageLengthCm: number | null; packageWidthCm: number | null; packageHeightCm: number | null;
  bicycleDeliveryEligible: boolean;
}) {
  return product.status !== 'ARCHIVED' && product.name === details.name.trim() && product.description === details.description.trim()
    && product.category_id === details.categoryId && Number(product.price_kobo) === details.priceKobo
    && (details.stockQuantity === undefined || Number(product.stock_quantity) === details.stockQuantity)
    && product.image_url === (details.imageUrls[0] ?? null)
    && JSON.stringify(sellerProductPhotos(product)) === JSON.stringify(details.imageUrls)
    && Number(product.preparation_minutes) === details.preparationMinutes
    && product.package_weight_grams === details.packageWeightGrams
    && [product.package_length_cm, product.package_width_cm, product.package_height_cm].every((value, index) =>
      value === null ? [details.packageLengthCm, details.packageWidthCm, details.packageHeightCm][index] === null
        : Number(value) === [details.packageLengthCm, details.packageWidthCm, details.packageHeightCm][index])
    && product.bicycle_delivery_eligible === details.bicycleDeliveryEligible;
}
