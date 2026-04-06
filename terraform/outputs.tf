output "server_ip" {
  description = "Public IP of the Astroneer server"
  value       = hcloud_server.astro.ipv4_address
}

output "connect_address" {
  description = "Address to use in Astroneer (IP:Port)"
  value       = "${hcloud_server.astro.ipv4_address}:8777"
}
