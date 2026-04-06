variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key for server access"
  type        = string
}

variable "repo_url" {
  description = "GitHub repo URL (used to pull setup scripts on boot)"
  type        = string
}
