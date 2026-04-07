provider "vultr" {
  api_key = var.vultr_api_key
}

data "vultr_os" "ubuntu" {
  filter {
    name   = "name"
    values = ["Ubuntu 22.04 LTS x64"]
  }
}

locals {
  raw_base = replace(var.repo_url, "https://github.com/", "https://raw.githubusercontent.com/")
  # Vultr label: alphanumeric chunks joined by "-"; max 32 chars (hostname stays "astro").
  _label_parts = regexall("[a-z0-9]+", lower(var.server_name))
  _slug        = length(local._label_parts) > 0 ? join("-", local._label_parts) : "astroneer"
  instance_lbl = substr(local._slug, 0, 32)
}

resource "vultr_ssh_key" "astro" {
  name    = "astroneer-astro"
  ssh_key = var.ssh_public_key
}

resource "vultr_firewall_group" "astro" {
  description = "astroneer-dedicated"
}

resource "vultr_firewall_rule" "astro_tcp" {
  firewall_group_id = vultr_firewall_group.astro.id
  ip_type           = "v4"
  protocol          = "tcp"
  port              = "8777"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  notes             = "Astroneer TCP"
}

resource "vultr_firewall_rule" "astro_udp" {
  firewall_group_id = vultr_firewall_group.astro.id
  ip_type           = "v4"
  protocol          = "udp"
  port              = "8777"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  notes             = "Astroneer UDP"
}

resource "vultr_firewall_rule" "astro_ssh" {
  firewall_group_id = vultr_firewall_group.astro.id
  ip_type           = "v4"
  protocol          = "tcp"
  port              = "22"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  notes             = "SSH"
}

resource "vultr_instance" "astro" {
  plan              = var.plan
  region            = var.region
  os_id             = data.vultr_os.ubuntu.id
  label             = local.instance_lbl
  hostname          = "astro"
  enable_ipv6       = false
  backups           = "disabled"
  ddos_protection   = false
  activation_email  = false
  ssh_key_ids       = [vultr_ssh_key.astro.id]
  firewall_group_id = vultr_firewall_group.astro.id
  # Plain YAML — Vultr passes this through to cloud-init. Do not base64encode() here (AWS-style);
  # encoding caused cloud-init to see raw Base64 and skip #cloud-config / runcmd.
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    bootstrap_url   = "${local.raw_base}/main/terraform/vultr/bootstrap.sh"
    server_name_b64 = base64encode(var.server_name)
  })
}

resource "vultr_block_storage" "saves" {
  region  = var.region
  size_gb = var.saves_size_gb
  label   = "astro-saves"

  # When false, no reference to vultr_instance — `apply -target` during setup
  # does not pull in compute (see attach_saves_volume / scripts/setup.tsx).
  attached_to_instance = var.attach_saves_volume ? vultr_instance.astro.id : null
  live                 = var.attach_saves_volume
}
