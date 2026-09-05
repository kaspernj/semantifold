# Source-independent development image for Semantifold's canonical `dev` service.
# Project source and npm dependencies arrive through the /home/dev bind mount.
FROM ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

ARG NODEJS_VERSION=24.18.1-1nodesource1
ARG NODESOURCE_KEY_SHA256=b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
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

RUN test "$(id -u ubuntu)" = "1000" \
  && test "$(id -g ubuntu)" = "1000" \
  && usermod --login dev --home /home/dev --move-home ubuntu \
  && groupmod --new-name dev ubuntu \
  && test "$(id -u dev)" = "1000" \
  && test "$(id -g dev)" = "1000"

USER dev
ENV HOME=/home/dev
WORKDIR /home/dev/semantifold

CMD ["sleep", "infinity"]
