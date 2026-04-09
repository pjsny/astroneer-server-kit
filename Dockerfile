# syntax=docker/dockerfile:1
# astroneer-server-kit — Astroneer dedicated (Windows depot) + Wine (WineHQ devel) — Fly.io Machines (AMD64).
#
# - Game install: SteamRE DepotDownloader (app 728470, Windows depot).
# - Wine: WineHQ **development** branch, pinned (Noble): winehq-devel=10.6~noble-1 — https://wiki.winehq.org/Ubuntu
# - GnuTLS: Ubuntu **libgnutls30t64** (Noble) = upstream **3.8.3** (see `apt-cache show libgnutls30t64`). No source build.
# - Prefix: persistent /data/winepfx on the Fly volume. Image ships an empty skel under /opt/wine-prefix-skel;
#   entrypoint-astroneer.sh runs wineboot on first boot if needed (avoids wineboot during docker build under QEMU).

FROM --platform=linux/amd64 ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
# Pin all arch-specific devel packages to the same version (otherwise apt may pick a
# newer wine-devel-amd64 and leave wine-devel / winehq-devel unsatisfiable).
ARG WINEHQ_DEVEL_VERSION=10.6~noble-1
ARG DEPOT_DOWNLOADER_TAG=DepotDownloader_3.4.0
ARG DEPOT_DOWNLOADER_SHA256=a999dec66b4850fc961bd50366696d23c2d0fad7b18790e6a5647b2f19097a53

LABEL org.opencontainers.image.title="astroneer-server-kit"

ENV DATA_DIR=/data \
    WINEPREFIX=/data/winepfx \
    WINEARCH=win64 \
    WINEDLLOVERRIDES="mscoree=;mshtml=;winegstreamer=" \
    WINEESYNC=1 \
    WINEFSYNC=1 \
    PATH=/opt/depotdownloader:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /data

# Single apt phase: deps + WineHQ + wine (i386); BuildKit cache speeds rebuilds.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    dpkg --add-architecture i386 \
    && mkdir -pm755 /etc/apt/keyrings \
    && apt-get update -y \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils unzip wget \
    && wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key \
    && wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/noble/winehq-noble.sources \
    && apt-get update -y \
    && apt-get install -y --no-install-recommends \
         iproute2 lsof \
         xvfb cabextract jq python3 gosu \
         zlib1g \
         libnss3 winbind libicu74 \
         libasound2t64 libasound2t64:i386 libasound2-plugins libasound2-plugins:i386 \
         libpulse0 libdbus-1-3 libfontconfig1 libfreetype6 \
         libjpeg-turbo8 libpng16-16t64 libopenal1 \
         libsdl2-2.0-0 libudev1 libxml2 libxslt1.1 \
         libx11-6 libxcomposite1 libxcursor1 libxext6 libxfixes3 \
         libxi6 libxinerama1 libxrandr2 libxrender1 libxxf86vm1 \
         libvulkan1 libvulkan1:i386 \
         libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer-plugins-bad1.0-0 \
         libosmesa6 libpcap0.8t64 libunwind8 libusb-1.0-0 \
         libldap2 libgsm1 libmpg123-0t64 libidn2-0 libp11-kit0 libtasn1-6 libnettle8t64 libhogweed6t64 \
         libgnutls30t64 \
    && apt-get install -y --install-recommends \
         "wine-devel-amd64=${WINEHQ_DEVEL_VERSION}" \
         "wine-devel-i386=${WINEHQ_DEVEL_VERSION}" \
         "wine-devel=${WINEHQ_DEVEL_VERSION}" \
         "winehq-devel=${WINEHQ_DEVEL_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# ---- DepotDownloader (SteamRE) ----
RUN curl -fsSL -o /tmp/depotdownloader.zip \
      "https://github.com/SteamRE/DepotDownloader/releases/download/${DEPOT_DOWNLOADER_TAG}/DepotDownloader-linux-x64.zip" \
    && echo "${DEPOT_DOWNLOADER_SHA256}  /tmp/depotdownloader.zip" | sha256sum -c - \
    && mkdir -p /opt/depotdownloader \
    && unzip -q /tmp/depotdownloader.zip -d /opt/depotdownloader \
    && chmod +x /opt/depotdownloader/DepotDownloader \
    && rm -f /tmp/depotdownloader.zip

RUN useradd -m -s /bin/bash astroneer

# Empty prefix skeleton (no wineboot here — fails under QEMU; runtime initializes).
RUN mkdir -p /opt/wine-prefix-skel/drive_c/users/astroneer/Temp \
    && chown -R astroneer:astroneer /opt/wine-prefix-skel \
    && mkdir -p /data \
    && chown -R astroneer:astroneer /data

RUN install -d /etc/default \
    && printf '%s\n' '# Optional: WINEDEBUG=+secur32,+gnutls' 'WINEDEBUG=-all' \
        'WINEDLLOVERRIDES="mscoree=;mshtml=;winegstreamer="' > /etc/default/astroneer \
    && chmod 644 /etc/default/astroneer

COPY docker/astroneer-server-run.sh /usr/local/bin/astroneer-server-run
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/entrypoint-astroneer.sh /usr/local/bin/entrypoint-astroneer.sh
RUN chmod +x /usr/local/bin/*

EXPOSE 8777/tcp 8777/udp 8779/tcp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
