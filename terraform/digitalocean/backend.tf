terraform {
  backend "s3" {
    # DigitalOcean Spaces (S3-compatible) for remote state
    # Bucket is created by bin/setup on first run
    endpoint = "https://nyc3.digitaloceanspaces.com"
    bucket   = "astro-server-tf-state"
    key      = "terraform.tfstate"
    region   = "us-east-1"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }
}
