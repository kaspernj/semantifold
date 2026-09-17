#!/bin/sh
set -eu

FLUTTER_HOME="${SEMANTIFOLD_FLUTTER_HOME:-/opt/semantifold-flutter-3.47.4}"
PUB_CACHE="${SEMANTIFOLD_FLUTTER_PUB_CACHE:-/opt/semantifold-flutter-pub-cache}"
JAVA_HOME="${SEMANTIFOLD_JAVA_HOME:-/opt/semantifold-jdk-21.0.8}"
BOOTSTRAP_ROOT="$(mktemp -d)"
ARCHIVE="$BOOTSTRAP_ROOT/flutter_linux_3.47.4-stable.tar.xz"
trap 'rm -rf "$BOOTSTRAP_ROOT"' EXIT HUP INT TERM

test "$FLUTTER_HOME" = /opt/semantifold-flutter-3.47.4
test "$PUB_CACHE" = /opt/semantifold-flutter-pub-cache
test "$JAVA_HOME" = /opt/semantifold-jdk-21.0.8
test "$(uname -m)" = x86_64
test "$(id -u)" != 0

curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
  https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.47.4-stable.tar.xz \
  --output "$ARCHIVE"
test "$(stat -c %s "$ARCHIVE")" = 1576174568
printf '%s  %s\n' '5b45f0ceda99b9bebdc873e7e69f6450aeb4c30f454b505e2e62fc9255a907d3' "$ARCHIVE" | \
  sha256sum --check -
tar -xJf "$ARCHIVE" -C "$BOOTSTRAP_ROOT"
test "$(git -C "$BOOTSTRAP_ROOT/flutter" rev-parse HEAD)" = 9584c6713b324636289d067944a46fd6b49df14b

sudo rm -rf "$FLUTTER_HOME"
sudo rm -rf "$PUB_CACHE"
sudo mv "$BOOTSTRAP_ROOT/flutter" "$FLUTTER_HOME"
sudo install -d -m 0755 "$PUB_CACHE"
sudo chown -R "$(id -u):$(id -g)" "$FLUTTER_HOME" "$PUB_CACHE"

VERSION_JSON="$(FLUTTER_ROOT="$FLUTTER_HOME" FLUTTER_SUPPRESS_ANALYTICS=true \
  "$FLUTTER_HOME/bin/cache/dart-sdk/bin/dart" "$FLUTTER_HOME/bin/cache/flutter_tools.snapshot" --version --machine)"
printf '%s\n' "$VERSION_JSON" | grep -Fq '"frameworkVersion": "3.47.4"'
printf '%s\n' "$VERSION_JSON" | grep -Fq '"frameworkRevision": "9584c6713b324636289d067944a46fd6b49df14b"'
printf '%s\n' "$VERSION_JSON" | grep -Fq '"dartSdkVersion": "3.13.3"'
test "$(find "$FLUTTER_HOME/.pub-preload-cache" -type f -name '*.tar.gz' | wc -l)" = 186

PUB_CACHE="$PUB_CACHE" PUB_HOSTED_URL=https://pub.dev \
  "$FLUTTER_HOME/bin/cache/dart-sdk/bin/dart" pub cache preload "$FLUTTER_HOME"/.pub-preload-cache/*.tar.gz >/dev/null

export SEMANTIFOLD_FLUTTER_HOME="$FLUTTER_HOME" SEMANTIFOLD_FLUTTER_PUB_CACHE="$PUB_CACHE"
export JAVA_HOME
export SEMANTIFOLD_FLUTTER_MODE=prepare
node scripts/flutter-acceptance.js
