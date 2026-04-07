/**
 * Common Vultr region slugs (compute + object storage). First entry is Terraform default (ewr), not written to `.env` when chosen.
 * See https://www.vultr.com/features/datacenter-locations/
 */
export const VULTR_REGION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Default — New Jersey, US (ewr)' },
  { value: 'ams', label: 'ams · Amsterdam, NL' },
  { value: 'atl', label: 'atl · Atlanta, US' },
  { value: 'blr', label: 'blr · Bangalore, IN' },
  { value: 'bom', label: 'bom · Mumbai, IN' },
  { value: 'cdg', label: 'cdg · Paris, FR' },
  { value: 'del', label: 'del · Delhi, IN' },
  { value: 'dfw', label: 'dfw · Dallas, US' },
  { value: 'ewr', label: 'ewr · New Jersey, US' },
  { value: 'fra', label: 'fra · Frankfurt, DE' },
  { value: 'icn', label: 'icn · Seoul, KR' },
  { value: 'jnb', label: 'jnb · Johannesburg, ZA' },
  { value: 'lax', label: 'lax · Los Angeles, US' },
  { value: 'lhr', label: 'lhr · London, UK' },
  { value: 'mad', label: 'mad · Madrid, ES' },
  { value: 'mel', label: 'mel · Melbourne, AU' },
  { value: 'mex', label: 'mex · Mexico City, MX' },
  { value: 'mia', label: 'mia · Miami, US' },
  { value: 'nrt', label: 'nrt · Tokyo, JP' },
  { value: 'ord', label: 'ord · Chicago, US' },
  { value: 'sao', label: 'sao · São Paulo, BR' },
  { value: 'sea', label: 'sea · Seattle, US' },
  { value: 'sgp', label: 'sgp · Singapore, SG' },
  { value: 'sjc', label: 'sjc · San Jose, US' },
  { value: 'syd', label: 'syd · Sydney, AU' },
  { value: 'waw', label: 'waw · Warsaw, PL' },
  { value: 'yto', label: 'yto · Toronto, CA' },
];
