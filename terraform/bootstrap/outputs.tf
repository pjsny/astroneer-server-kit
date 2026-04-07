output "s3_access_key" {
  description = "S3 access key for this object storage subscription"
  value       = vultr_object_storage.terraform_state.s3_access_key
  sensitive   = true
}

output "s3_secret_key" {
  description = "S3 secret key"
  value       = vultr_object_storage.terraform_state.s3_secret_key
  sensitive   = true
}

output "s3_hostname" {
  description = "Object storage hostname (no scheme), e.g. ewr1.vultrobjects.com"
  value       = vultr_object_storage.terraform_state.s3_hostname
}

output "s3_endpoint" {
  description = "HTTPS endpoint for S3-compatible clients"
  value       = "https://${vultr_object_storage.terraform_state.s3_hostname}"
}

output "tf_state_bucket" {
  description = "Bucket name to use for terraform remote state (must be created via S3 API)"
  value       = var.tf_state_bucket
}
