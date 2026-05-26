#!/usr/bin/env bash
# deploy.sh — Build, push, and deploy to a self-hosted k8s cluster.
#
# Usage:
#   ./scripts/deploy.sh <registry> <tag> [dev|prod]
#
# Example:
#   ./scripts/deploy.sh docker.io/youruser 1.0.0 prod
#
# Prerequisites:
#   - docker logged in to registry
#   - kubectl configured and pointing at your cluster
#   - kustomize (or kubectl >= 1.14 which bundles it)

set -euo pipefail

REGISTRY="${1:-YOUR_REGISTRY}"
TAG="${2:-latest}"
ENV="${3:-dev}"

INGESTION_IMAGE="${REGISTRY}/llm-ingestion:${TAG}"
FRONTEND_IMAGE="${REGISTRY}/llm-frontend:${TAG}"

echo "▶  Building images..."
docker build -t "${INGESTION_IMAGE}" ./backend/ingestion
docker build -t "${FRONTEND_IMAGE}"  ./frontend

echo "▶  Pushing images..."
docker push "${INGESTION_IMAGE}"
docker push "${FRONTEND_IMAGE}"

echo "▶  Patching image tags in overlay..."
# Update the image tags in the overlay kustomization before applying
cd "k8s/overlays/${ENV}"
kustomize edit set image \
  "YOUR_REGISTRY/llm-ingestion=${INGESTION_IMAGE}" \
  "YOUR_REGISTRY/llm-frontend=${FRONTEND_IMAGE}"
cd ../../..

echo "▶  Applying secret (if secret.yaml exists)..."
SECRET_FILE="k8s/base/ingestion/secret.yaml"
if [ -f "${SECRET_FILE}" ]; then
  kubectl apply -f "${SECRET_FILE}"
else
  echo "   ⚠️  ${SECRET_FILE} not found — skipping."
  echo "   Copy secret.yaml.example to secret.yaml and fill in your keys."
fi

echo "▶  Deploying overlay: ${ENV}..."
kubectl apply -k "k8s/overlays/${ENV}"

echo "▶  Waiting for rollout..."
kubectl rollout status deployment/ingestion -n llm-logger --timeout=120s
kubectl rollout status deployment/frontend  -n llm-logger --timeout=60s

echo ""
echo "✅  Deploy complete!"
kubectl get pods -n llm-logger
kubectl get svc  -n llm-logger
