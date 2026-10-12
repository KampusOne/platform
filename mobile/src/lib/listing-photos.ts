import { draftFormatError } from './draft-fields';
export function listingPhotos(value: unknown, cover = ''): string[] {
  if (value !== undefined && (!Array.isArray(value) || value.length > 6 || value.some(url => typeof url !== 'string' || !url || url.length > 4096)))
    throw draftFormatError();
  const photos = [...new Set((value ?? []) as string[])];
  if (cover) {
    const index = photos.indexOf(cover);
    if (index >= 0) photos.splice(index, 1);
    photos.unshift(cover);
  }
  if (photos.length > 6) throw draftFormatError();
  return photos;
}
export function moveListingPhoto(photos: readonly string[], from: number, to: number): string[] {
  if (![from, to].every(index => Number.isSafeInteger(index) && index >= 0 && index < photos.length)) return [...photos];
  const next = [...photos], [photo] = next.splice(from, 1);
  next.splice(to, 0, photo!);
  return next;
}
