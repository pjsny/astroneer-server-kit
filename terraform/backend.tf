terraform {
  backend "s3" {
    # DigitalOcean Spaces (S3-compatible) for remote state
    # Create a Space called "astro-server-tf-state" in nyc3 first
    endpoint = "https://nyc3.digitaloceanspaces.com"
    bucket   = "astro-server-tf-state"
    key      = "terraform.tfstate"
    region   = "us-east-1" # required by S3 provider, value doesn't matter for DO Spaces

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }
}
