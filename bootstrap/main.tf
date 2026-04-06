terraform {
  # Intentionally local — this only runs once to create the remote state bucket
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

# The Space (S3-compatible bucket) that stores Terraform state for the main config
resource "digitalocean_spaces_bucket" "tf_state" {
  name   = "astro-server-tf-state"
  region = "nyc3"

  # Prevent accidental deletion of the state bucket
  lifecycle {
    prevent_destroy = true
  }
}

output "spaces_bucket_name" {
  value = digitalocean_spaces_bucket.tf_state.name
}

output "spaces_endpoint" {
  value = "https://${digitalocean_spaces_bucket.tf_state.region}.digitaloceanspaces.com"
}

output "next_steps" {
  value = <<-MSG
    Bootstrap complete!

    Next: create a Spaces access key in the DO console:
      https://cloud.digitalocean.com/account/api/spaces

    Then run the main config:
      cd ../terraform
      terraform init \
        -backend-config="access_key=YOUR_SPACES_KEY" \
        -backend-config="secret_key=YOUR_SPACES_SECRET"
  MSG
}
