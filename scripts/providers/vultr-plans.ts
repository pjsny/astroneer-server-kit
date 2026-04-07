/** Vultr Cloud Compute (vc2) plans — prices are rough US/month guides; confirm at vultr.com/pricing. */
export interface VultrComputePlanOption {
  slug: string;
  label: string;
  priceHint: string;
  /** Astroneer + Wine on the same VM */
  guidance: string;
}

/** Default index: 4 vCPU / 8 GB — solid baseline under Wine for a small dedicated host (official docs cap 8 players, Steam). */
export const VULTR_COMPUTE_PLANS: VultrComputePlanOption[] = [
  {
    slug:      "vc2-2c-4gb",
    label:     "2 vCPU · 4 GB RAM",
    priceHint: "~$24/mo",
    guidance:
      "Minimal. Fine for testing; Wine + UE makes this tight for several explorers — expect hitches with a fuller save.",
  },
  {
    slug:      "vc2-4c-8gb",
    label:     "4 vCPU · 8 GB RAM",
    priceHint: "~$48/mo",
    guidance:
      "Recommended starting point for a self-hosted dedicated server (Steam, up to 8 players). Leaves headroom for Wine.",
  },
  {
    slug:      "vc2-6c-16gb",
    label:     "6 vCPU · 16 GB RAM",
    priceHint: "~$96/mo",
    guidance:
      "Comfortable for a busy world or when you want margin for updates and background work.",
  },
  {
    slug:      "vc2-8c-32gb",
    label:     "8 vCPU · 32 GB RAM",
    priceHint: "~$192/mo",
    guidance:
      "Heavy saves or extra services on the same VM; overkill for vanilla Astroneer alone but very smooth.",
  },
];

export const DEFAULT_VULTR_PLAN_SLUG = "vc2-4c-8gb";

export const SETUP_LEGAL_BLURB =
  "Self-hosting is at your own risk: firewalls, ports, and security are on you. System Era does not warranty third-party hosts. " +
  "Only edit Engine.ini and AstroServerSettings.ini while the server is stopped. Official client uses TCP/UDP 8777 (configurable in Engine.ini). " +
  "Do not modify the game or abuse backend services — that risks a ban.";
