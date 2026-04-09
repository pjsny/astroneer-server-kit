/** Common Fly.io regions — see https://fly.io/docs/reference/regions/ */
export const FLY_REGION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ord", label: "Chicago (ord)" },
  { value: "iad", label: "Ashburn, VA (iad)" },
  { value: "dfw", label: "Dallas (dfw)" },
  { value: "sea", label: "Seattle (sea)" },
  { value: "sjc", label: "San Jose (sjc)" },
  { value: "lhr", label: "London (lhr)" },
  { value: "fra", label: "Frankfurt (fra)" },
  { value: "ams", label: "Amsterdam (ams)" },
  { value: "syd", label: "Sydney (syd)" },
  { value: "nrt", label: "Tokyo (nrt)" },
];

export const DEFAULT_FLY_REGION = "ord";

export const FLY_MEMORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "4gb", label: "4 GB RAM — light testing" },
  { value: "8gb", label: "8 GB RAM — recommended" },
  { value: "16gb", label: "16 GB RAM — headroom / larger saves" },
];

export const DEFAULT_FLY_VM_MEMORY = "8gb";
