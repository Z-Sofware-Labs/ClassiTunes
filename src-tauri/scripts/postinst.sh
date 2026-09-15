#!/bin/sh
# postinst.sh - runs as root after the ClassiTunes .deb package installs.
# Attempts to install the additional GStreamer codec packages that ship in
# Ubuntu's "universe" / "multiverse" repos and are NOT safe to declare as
# hard apt dependencies (because they may require the user to have those
# repos enabled first).

# All fallible commands use || true so a codec install failure never
# causes the overall package installation to roll back.

MISSING=""
for pkg in gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly ffmpeg; do
    if ! dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -z "$MISSING" ]; then
    exit 0
fi

echo "ClassiTunes: Enabling universe/multiverse repositories for audio codec support..."
add-apt-repository -y universe  2>/dev/null || true
add-apt-repository -y multiverse 2>/dev/null || true
apt-get update -qq 2>/dev/null || true

echo "ClassiTunes: Installing missing audio codec packages:$MISSING"
apt-get install -y --no-install-recommends $MISSING 2>/dev/null || true

echo "ClassiTunes: Audio codec setup complete."
exit 0