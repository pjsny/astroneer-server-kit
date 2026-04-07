provider "vultr" {
  api_key = var.vultr_api_key
}

# The Terraform data source errors when more than one cluster shares the same `region`
# (even with deploy=yes). List clusters via the public API and pick a stable choice: minimum id.
data "http" "object_storage_clusters" {
  count = var.object_storage_cluster_id == null ? 1 : 0

  url = "https://api.vultr.com/v2/object-storage/clusters?per_page=500"
  request_headers = {
    Authorization = "Bearer ${var.vultr_api_key}"
    Accept        = "application/json"
  }
}

locals {
  _cluster_list = var.object_storage_cluster_id == null ? try(jsondecode(data.http.object_storage_clusters[0].response_body).clusters, []) : []
  _candidates = [
    for c in local._cluster_list : c
    if try(c.region, "") == var.region && lower(try(c.deploy, "")) == "yes"
  ]
  _candidate_ids = [for c in local._candidates : c.id]
  object_storage_cluster_id = (
    var.object_storage_cluster_id != null
    ? var.object_storage_cluster_id
    : length(local._candidate_ids) > 0
    ? min(local._candidate_ids...)
    : null
  )
}

# Tier IDs are per-cluster; tier `1` is not valid everywhere — list tiers for this cluster only.
data "http" "cluster_tiers" {
  count = local.object_storage_cluster_id != null ? 1 : 0

  url = "https://api.vultr.com/v2/object-storage/clusters/${local.object_storage_cluster_id}/tiers"
  request_headers = {
    Authorization = "Bearer ${var.vultr_api_key}"
    Accept        = "application/json"
  }
}

locals {
  _tiers_raw = (
    length(data.http.cluster_tiers) > 0
    ? try(jsondecode(data.http.cluster_tiers[0].response_body).tiers, [])
    : []
  )
  _tier_ids         = [for t in local._tiers_raw : t.id]
  _default_tier_ids = [for t in local._tiers_raw : t.id if lower(try(t.is_default, "")) == "yes"]
  _default_tier     = length(local._default_tier_ids) > 0 ? local._default_tier_ids[0] : null
  # Prefer TF_VAR when that tier exists on this cluster; else cluster default; else smallest catalog id.
  object_storage_tier_id = (
    length(local._tier_ids) == 0 ? var.object_storage_tier_id : (
      contains(local._tier_ids, var.object_storage_tier_id) ? var.object_storage_tier_id : (
        local._default_tier != null ? local._default_tier : min(local._tier_ids...)
      )
    )
  )
}

resource "random_id" "os_label" {
  byte_length = 3
}

resource "vultr_object_storage" "terraform_state" {
  lifecycle {
    precondition {
      condition     = local.object_storage_cluster_id != null
      error_message = <<-EOT
        No object storage cluster for region "${var.region}" with deploy=yes (or API list failed).
        List clusters: curl -s -H "Authorization: Bearer $VULTR_API_KEY" https://api.vultr.com/v2/object-storage/clusters
        Then set TF_VAR_object_storage_cluster_id to the numeric "id" you want.
      EOT
    }
  }

  cluster_id = local.object_storage_cluster_id
  tier_id    = local.object_storage_tier_id
  label      = "astro-tf-${random_id.os_label.hex}"
}
