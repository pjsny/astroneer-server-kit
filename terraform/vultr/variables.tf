variable "vultr_api_key" {
  type        = string
  description = "Vultr API key (Bearer token)"
  sensitive   = true
}

variable "region" {
  type        = string
  description = "Vultr region slug (e.g. ewr, lax, sea)"
  default     = "ewr"
}

variable "plan" {
  type        = string
  description = "Vultr Cloud Compute plan slug (vc2-*)"
  default     = "vc2-4c-8gb"
}

variable "server_name" {
  type        = string
  description = "ServerName in AstroServerSettings.ini (in-game browser)"
  default     = "My Astroneer Server"
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key for root login"
}

variable "repo_url" {
  type        = string
  description = "Fork URL (https://github.com/user/repo) for bootstrap script download"
}

variable "saves_size_gb" {
  type        = number
  description = "Block storage size for persistent saves (GB)"
  default     = 50
}

variable "attach_saves_volume" {
  type        = bool
  description = "When false, block storage is created without attaching to the instance (setup wizard only; use true for make start / normal apply)."
  default     = true
}
