output "server_ip" {
  description = "Public IPv4 of the Astroneer instance"
  value       = vultr_instance.astro.main_ip
}
