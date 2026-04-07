/** S3 bucket name derived from server display name (+ short random suffix for uniqueness on shared clusters). */
export function terraformStateBucketFromServerName(displayName: string): string {
  let slug = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) slug = "world";
  const rand = Math.random().toString(36).slice(2, 6);
  let name = `astro-${slug}-${rand}-tf-state`;
  if (name.length > 63) {
    const keep = 63 - (`astro--${rand}-tf-state`.length);
    slug = slug.slice(0, Math.max(1, keep)).replace(/-+$/g, "");
    name = `astro-${slug}-${rand}-tf-state`;
  }
  return name.slice(0, 63).replace(/-+$/g, "").replace(/^-+/, "") || `astro-${rand}-tf-state`;
}
