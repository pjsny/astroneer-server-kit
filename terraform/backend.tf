terraform {
  backend "s3" {
    # Hetzner Object Storage (S3-compatible) for remote state
    # Bucket is created by bin/setup on first run
    endpoint = "https://fsn1.your-objectstorage.com"
    bucket   = "astro-server-tf-state"
    key      = "terraform.tfstate"
    region   = "fsn1"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }
}
