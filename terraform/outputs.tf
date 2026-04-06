output "server_ip" {
  description = "Public IP of the Astroneer server"
  value       = digitalocean_droplet.astro.ipv4_address
}

output "connect_address" {
  description = "Address to use in Astroneer (IP:Port)"
  value       = "${digitalocean_droplet.astro.ipv4_address}:8777"
}
