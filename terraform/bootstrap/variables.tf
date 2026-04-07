variable "vultr_api_key" {
  type        = string
  description = "Vultr API key"
  sensitive   = true
}

variable "region" {
  type        = string
  description = "Region slug matching compute (e.g. ewr) — object storage cluster must exist there"
  default     = "ewr"
}

variable "object_storage_cluster_id" {
  type        = number
  description = "Optional. Use when region+deploy still matches multiple clusters. Cluster IDs: https://api.vultr.com/v2/object_storage/clusters"
  default     = null
  nullable    = true
}

variable "object_storage_tier_id" {
  type        = number
  description = "Preferred tier id if listed for the chosen cluster (tiers vary by location). Otherwise the module picks is_default or the smallest id from GET .../clusters/{id}/tiers."
  default     = 1
}

variable "tf_state_bucket" {
  type        = string
  description = "S3 bucket name created inside this subscription for Terraform remote state"
  default     = "astroneer-terraform-state"
}
