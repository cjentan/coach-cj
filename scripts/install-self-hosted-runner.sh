#!/usr/bin/env bash
set -euo pipefail

# Install a GitHub Actions self-hosted runner on the production host so that
# pushing to main auto-deploys (see .github/workflows/deploy.yml).
#
# Run ONCE on the host, as the user that owns /docker-data/coach and has docker
# access (currently `cjentan`). Registers the runner for this repo and installs
# it as a systemd service so it survives reboots.
#
#   RUNNER_TOKEN=<registration-token> bash scripts/install-self-hosted-runner.sh
#
# Get a registration token (expires after 1 hour) from:
#   GitHub → your repo → Settings → Actions → Runners → "New self-hosted runner"
#   (copy the token shown in the ./config.sh command).
#
# Or mint one yourself with a repo-scoped PAT:
#   curl -X POST -H "Authorization: Bearer $PAT" \
#     https://api.github.com/repos/cjentan/coach-cj/actions/runners/registration-token

REPO="cjentan/coach-cj"
RUNNER_NAME="${RUNNER_NAME:-coach-prod-runner}"
LABELS="${LABELS:-self-hosted,linux,x64,deploy}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_VERSION="${RUNNER_VERSION:-}"   # empty = use latest release
ARCH="linux-x64"

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "ERROR: RUNNER_TOKEN is required. See header comment for how to get one." >&2
  exit 1
fi

for cmd in curl tar rsync docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing required command: $cmd" >&2; exit 1; }
done

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: this user cannot use docker without sudo — the runner needs docker access." >&2
  exit 1
fi

# Resolve the runner version (latest release, with a pinned fallback).
if [ -z "$RUNNER_VERSION" ]; then
  # grep -m1 exits right after the first match, closing the pipe while curl is
  # still reading the JSON. That is a benign write error (curl exit 23), but with
  # pipefail+set -e it would abort the script — so swallow it. The version is
  # captured correctly anyway; only the spurious curl error is suppressed.
  RUNNER_VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest 2>/dev/null \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"v?([^"]+)".*/\1/' \
    || true)"
fi
RUNNER_VERSION="${RUNNER_VERSION:-2.320.0}"  # fallback if the API was rate-limited

echo "Installing actions-runner ${RUNNER_VERSION} (${ARCH}) into ${RUNNER_DIR}"

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -x "./config.sh" ]; then
  curl -fsSL -o runner.tgz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-${ARCH}-${RUNNER_VERSION}.tar.gz"
  tar xzf runner.tgz
  rm runner.tgz
fi

./config.sh \
  --url "https://github.com/${REPO}" \
  --token "${RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${LABELS}" \
  --unattended

# Install as a systemd service (will prompt for sudo). The runner starts
# automatically on boot and after crashes.
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status || true

echo ""
echo "Done. The runner should appear under Settings → Actions → Runners."
echo "The next push to main triggers .github/workflows/deploy.yml."
