terraform {
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

# SSH key
resource "digitalocean_ssh_key" "astro" {
  name       = "astro-server-key"
  public_key = var.ssh_public_key
}

# Persistent volume for world saves (survives server destruction)
resource "digitalocean_volume" "saves" {
  name                    = "astro-saves"
  size                    = 10
  region                  = "nyc3"
  initial_filesystem_type = "ext4"

  lifecycle {
    prevent_destroy = true
  }
}

# The server
resource "digitalocean_droplet" "astro" {
  name      = "astro-server"
  image     = "ubuntu-22-04-x64"
  size      = "s-2vcpu-4gb"
  region    = "nyc3"
  ssh_keys  = [digitalocean_ssh_key.astro.id]

  # cloud-init: runs on first boot, sets up everything automatically
  user_data = <<-EOF
    #!/bin/bash
    set -e
    apt update -y
    apt install -y git
    git clone ${var.repo_url} /opt/astro-setup
    cd /opt/astro-setup
    bash setup.sh
  EOF
}

# Firewall (associated after droplet is created)
resource "digitalocean_firewall" "astro" {
  name        = "astro-server"
  droplet_ids = [digitalocean_droplet.astro.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "8777"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "udp"
    port_range       = "8777"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Attach the saves volume
resource "digitalocean_volume_attachment" "saves" {
  droplet_id = digitalocean_droplet.astro.id
  volume_id  = digitalocean_volume.saves.id
}
