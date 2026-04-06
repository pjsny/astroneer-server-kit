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

# Persistent volume for world saves (survives droplet destroy)
resource "digitalocean_volume" "saves" {
  region      = "nyc3"
  name        = "astro-saves"
  size        = 10
  description = "Astroneer world saves — persists between sessions"

  lifecycle {
    prevent_destroy = true # never accidentally delete saves
  }
}

# Firewall
resource "digitalocean_firewall" "astro" {
  name = "astro-server"

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

  outbound_rule {
    protocol              = "tcp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  droplet_ids = [digitalocean_droplet.astro.id]
}

# The droplet
resource "digitalocean_droplet" "astro" {
  name   = "astro-server"
  region = "nyc3"
  size   = "s-2vcpu-4gb"
  image  = "ubuntu-22-04-x64"

  ssh_keys = [digitalocean_ssh_key.astro.fingerprint]

  # cloud-init: runs on first boot, sets up everything automatically
  user_data = <<-EOF
    #!/bin/bash
    set -e

    # Mount the saves volume
    mkdir -p /mnt/saves
    mount -o discard,defaults /dev/disk/by-id/scsi-0DO_Volume_astro-saves /mnt/saves || true
    echo '/dev/disk/by-id/scsi-0DO_Volume_astro-saves /mnt/saves ext4 defaults,nofail,discard 0 2' >> /etc/fstab

    # Install git and pull setup scripts
    apt update -y
    apt install -y git

    git clone ${var.repo_url} /opt/astro-setup
    cd /opt/astro-setup

    bash setup.sh
  EOF
}

# Attach the saves volume to the droplet
resource "digitalocean_volume_attachment" "saves" {
  droplet_id = digitalocean_droplet.astro.id
  volume_id  = digitalocean_volume.saves.id
}
