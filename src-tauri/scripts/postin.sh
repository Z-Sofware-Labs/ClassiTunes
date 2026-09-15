#!/bin/sh
# postin.sh - runs as root after the ClassiTunes .rpm package installs.
# Attempts to install the additional GStreamer codec packages from RPM Fusion.
# RPM Fusion (Free + Non-Free) is the standard source for MP3/AAC codecs on
# Fedora and is NOT enabled by default, so these cannot be declared as hard
# RPM dependencies.

RPMFUSION_FREE="https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm"
RPMFUSION_NONFREE="https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-$(rpm -E %fedora).noarch.rpm"

MISSING=""
for pkg in gstreamer1-plugins-bad-free gstreamer1-plugins-ugly ffmpeg; do
    if ! rpm -q "$pkg" >/dev/null 2>&1; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -z "$MISSING" ]; then
    exit 0
fi

echo "ClassiTunes: Enabling RPM Fusion repositories for audio codec support..."
dnf install -y "$RPMFUSION_FREE" "$RPMFUSION_NONFREE" 2>/dev/null || true

echo "ClassiTunes: Installing missing audio codec packages:$MISSING"
dnf install -y $MISSING 2>/dev/null || true

echo "ClassiTunes: Audio codec setup complete."
exit 0