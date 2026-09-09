# Source-independent development image for Semantifold's canonical `dev` service.
# Project source and npm dependencies arrive through the /home/dev bind mount.
# The pinned multi-architecture image resolves to linux/amd64 manifest
# sha256:4e0fc24f0f93a5cf9a91bfcf182534bbc0571d70d757389c04ff1f616c1c460f.
FROM swift:6.3.3-noble@sha256:56ef1be2c1ca36f4c52440357dc1fcdfdb5e113587134fcadeef57c225c71b54 AS swift-toolchain

RUN test "$(swiftc --version | sed -n '1p')" = "Swift version 6.3.3 (swift-6.3.3-RELEASE)" \
  && test "$(swiftc --version | sed -n 's/^Target: //p')" = "x86_64-unknown-linux-gnu"

FROM ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

ARG NODEJS_VERSION=24.18.1-1nodesource1
ARG NODESOURCE_KEY_SHA256=b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d

ENV DEBIAN_FRONTEND=noninteractive

COPY --from=swift-toolchain /usr/bin/swift* /usr/bin/
COPY --from=swift-toolchain /usr/lib/swift /usr/lib/swift

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    clang=1:21.1.6-71 \
    clang-21=1:21.1.8-6ubuntu1 \
    libclang-rt-21-dev=1:21.1.8-6ubuntu1 \
    libncurses6 \
    libstdc++-15-dev=15.2.0-16ubuntu1 \
    libxml2-dev \
    curl \
    default-jdk-headless \
    dotnet-sdk-10.0 \
    git \
    gh \
    gnupg \
    golang-go \
    jq \
    openssh-client \
    php-cli \
    python3 \
    ripgrep \
    ruby \
    wabt=1.0.36+dfsg+~cs1.0.36-2ubuntu1 \
    xz-utils \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl --fail --silent --show-error --location \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    --output /etc/apt/keyrings/nodesource.asc \
  && echo "${NODESOURCE_KEY_SHA256}  /etc/apt/keyrings/nodesource.asc" | sha256sum --check - \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends "nodejs=${NODEJS_VERSION}" \
  && test "$(node --version)" = "v${NODEJS_VERSION%-1nodesource1}" \
  && clang --version \
  && clang -dumpmachine \
  && clang -print-resource-dir \
  && clang++-21 --version \
  && test "$(clang++-21 -dumpversion)" = "21.1.8" \
  && test -r "$(clang++-21 -print-file-name=libstdc++.so)" \
  && php --version \
  && python3 --version \
  && ruby --version \
  && javac -version \
  && java -version \
  && dotnet --info \
  && test "$(dotnet --version | cut -d. -f1)" = "10" \
  && go version \
  && go env GOVERSION GOOS GOARCH GOROOT \
  && test "$(go env GOVERSION | cut -d. -f1,2)" = "go1.26" \
  && test "$(go env GOOS)" = "linux" \
  && test "$(go env GOARCH)" = "amd64" \
  && test -n "$(go env GOROOT)" \
  && test -x "$(go env GOROOT)/bin/gofmt" \
  && test "$(readlink -f "$(command -v gofmt)")" = "$(readlink -f "$(go env GOROOT)/bin/gofmt")" \
  && rm -rf /var/lib/apt/lists/*

RUN test "$(dpkg --print-architecture)" = "amd64" \
  && curl --fail --silent --show-error --location \
    "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_152.0.7977.82-1_amd64.deb" \
    --output "/tmp/google-chrome-stable_152.0.7977.82-1_amd64.deb" \
  && echo "4d25e4a028c78a7ae910683551c2f234792cc5595e7e3e34939f599342ada446  /tmp/google-chrome-stable_152.0.7977.82-1_amd64.deb" | sha256sum --check - \
  && apt-get update \
  && apt-get install --yes --no-install-recommends "/tmp/google-chrome-stable_152.0.7977.82-1_amd64.deb" \
  && ln --symbolic /usr/bin/google-chrome-stable /usr/local/bin/chromium \
  && test "$(wasm-validate --version)" = "1.0.36" \
  && test "$(chromium --version | sed 's/ $//')" = "Google Chrome 152.0.7977.82" \
  && chromium --headless=new --no-sandbox --disable-gpu --dump-dom about:blank > /tmp/semantifold-chromium-probe.html \
  && rm -f "/tmp/google-chrome-stable_152.0.7977.82-1_amd64.deb" /tmp/semantifold-chromium-probe.html \
  && rm -rf /var/lib/apt/lists/*

RUN test "$(dpkg --print-architecture)" = "amd64" \
  && install -d -m 0755 /tmp/semantifold-rust \
  && cd /tmp/semantifold-rust \
  && curl --fail --silent --show-error --location \
    https://static.rust-lang.org/dist/2026-09-03/rustc-1.98.1-x86_64-unknown-linux-gnu.tar.xz \
    --output rustc-1.98.1-x86_64-unknown-linux-gnu.tar.xz \
  && echo 'e974f036b28565f37c0f3bd92ddefa809bee16c04f9dcf07b9ed96e05aaaf7c4  rustc-1.98.1-x86_64-unknown-linux-gnu.tar.xz' | sha256sum --check - \
  && curl --fail --silent --show-error --location \
    https://static.rust-lang.org/dist/2026-09-03/rust-std-1.98.1-x86_64-unknown-linux-gnu.tar.xz \
    --output rust-std-1.98.1-x86_64-unknown-linux-gnu.tar.xz \
  && echo 'fa3ff450172a16c026944030230c5069947af93c728d9179971d44e5e0cfb561  rust-std-1.98.1-x86_64-unknown-linux-gnu.tar.xz' | sha256sum --check - \
  && curl --fail --silent --show-error --location \
    https://static.rust-lang.org/dist/2026-09-03/cargo-1.98.1-x86_64-unknown-linux-gnu.tar.xz \
    --output cargo-1.98.1-x86_64-unknown-linux-gnu.tar.xz \
  && echo 'ea1de9f9e23107d97ee2b41a72c552f34064a593da503789218387aee59f3ba4  cargo-1.98.1-x86_64-unknown-linux-gnu.tar.xz' | sha256sum --check - \
  && for component in rustc rust-std cargo; do \
    tar -xJf "${component}-1.98.1-x86_64-unknown-linux-gnu.tar.xz" \
    && "./${component}-1.98.1-x86_64-unknown-linux-gnu/install.sh" --prefix=/opt/rust-1.98.1 --disable-ldconfig \
    || exit 1; \
  done \
  && ln --symbolic /opt/rust-1.98.1/bin/rustc /usr/local/bin/rustc \
  && ln --symbolic /opt/rust-1.98.1/bin/cargo /usr/local/bin/cargo \
  && rustc --version --verbose \
  && cargo --version --verbose \
  && test "$(rustc --version)" = 'rustc 1.98.1 (48a229cea 2026-09-01)' \
  && test "$(cargo --version)" = 'cargo 1.98.1 (797e8a9bc 2026-08-05)' \
  && test "$(rustc --print sysroot)" = '/opt/rust-1.98.1' \
  && test "$(rustc --version --verbose | sed -n 's/^host: //p')" = 'x86_64-unknown-linux-gnu' \
  && test "$(cargo --version --verbose | sed -n 's/^host: //p')" = 'x86_64-unknown-linux-gnu' \
  && test "$(rustc --version --verbose | sed -n 's/^commit-hash: //p')" = '48a229ceaefd4985c50990b14116b6d856af0985' \
  && test "$(cargo --version --verbose | sed -n 's/^commit-hash: //p')" = '797e8a9bca276c1c9f9f738d2a20f484fa4eea9d' \
  && rm -rf /tmp/semantifold-rust

RUN swiftc --version \
  && test "$(swiftc --version | sed -n '1p')" = "Swift version 6.3.3 (swift-6.3.3-RELEASE)" \
  && test "$(swiftc --version | sed -n 's/^Target: //p')" = "x86_64-unknown-linux-gnu"

RUN test "$(id -u ubuntu)" = "1000" \
  && test "$(id -g ubuntu)" = "1000" \
  && usermod --login dev --home /home/dev --move-home ubuntu \
  && groupmod --new-name dev ubuntu \
  && test "$(id -u dev)" = "1000" \
  && test "$(id -g dev)" = "1000"

RUN PROVIDER_NPM_CACHE="$(mktemp -d)" \
  && npm install --global --cache "${PROVIDER_NPM_CACHE}" \
    opencode-ai \
    @openai/codex \
    @anthropic-ai/claude-code \
    @moonshot-ai/kimi-code \
  && rm -rf "${PROVIDER_NPM_CACHE}"

USER dev
ENV HOME=/home/dev
WORKDIR /home/dev/semantifold

RUN command -v opencode \
  && opencode --version \
  && command -v codex \
  && codex --version

CMD ["sleep", "infinity"]
