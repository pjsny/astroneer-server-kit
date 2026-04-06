terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# SSH key
resource "hcloud_ssh_key" "astro" {
  name       = "astro-server-key"
  public_key = var.ssh_public_key
}

# Persistent volume for world saves (survives server destruction)
resource "hcloud_volume" "saves" {
  name     = "astro-saves"
  size     = 10
  location = "ash"
  format   = "ext4"

  lifecycle {
    prevent_destroy = true
  }
}

# Firewall
resource "hcloud_firewall" "astro" {
  name = "astro-server"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "8777"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8777"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

# The server
resource "hcloud_server" "astro" {
  name         = "astro-server"
  image        = "ubuntu-22.04"
  server_type  = "cx22"
  location     = "ash"
  ssh_keys     = [hcloud_ssh_key.astro.id]
  firewall_ids = [hcloud_firewall.astro.id]

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

# Attach the saves volume
resource "hcloud_volume_attachment" "saves" {
  server_id  = hcloud_server.astro.id
  volume_id  = hcloud_volume.saves.id
  automount  = false
}
