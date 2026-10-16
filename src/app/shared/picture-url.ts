/** Object URLs of picture bytes, made once per byte array (pictures are shown again and again while sketching). */
const urls = new WeakMap<Uint8Array, string>();

export function pictureUrl(bytes: Uint8Array, mediaType: string): string {
  let url = urls.get(bytes);
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }));
    urls.set(bytes, url);
  }
  return url;
}
