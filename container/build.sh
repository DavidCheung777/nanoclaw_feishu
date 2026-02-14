#!/bin/bash
# Build the NanoClaw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Build with Docker (auto-detect if podman is available and use that instead)
if command -v podman &> /dev/null; then
  echo "Using Podman for container builds..."
  podman build -t "${IMAGE_NAME}:${TAG}" .
elif command -v docker &> /dev/null; then
  echo "Using Docker for container builds..."
  docker build -t "${IMAGE_NAME}:${TAG}" .
else
  echo "ERROR: No container runtime found (docker or podman)"
  exit 1
fi

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | docker run -i ${IMAGE_NAME}:${TAG}"
