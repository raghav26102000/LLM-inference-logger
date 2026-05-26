# LLM Inference Logger — Self-Hosted Kubernetes Deployment

Two ways to deploy — pick one:

| Method | Best for |
|--------|----------|
| **Raw manifests** (`k8s/base/`) | Learning, full control, no extra tooling |
| **Helm chart** (`helm/llm-logger/`) | Repeatable deploys, multiple environments, values overrides |

---

## Prerequisites

- Kubernetes cluster (tested on k3s, kubeadm, kind)
- `kubectl` configured and pointing at your cluster
- Docker registry you can push to (Docker Hub, GHCR, self-hosted)
- (For Helm path) `helm` v3+

---

## Quick Start — Raw Manifests

```bash
# 1. Build and push your images
docker build -t YOUR_REGISTRY/llm-ingestion:latest ./backend/ingestion
docker build -t YOUR_REGISTRY/llm-frontend:latest  ./frontend
docker push YOUR_REGISTRY/llm-ingestion:latest
docker push YOUR_REGISTRY/llm-frontend:latest

# 2. Fill in your API keys and registry
cp k8s/base/ingestion/secret.yaml.example k8s/base/ingestion/secret.yaml
# Edit secret.yaml with base64-encoded keys (see instructions inside)

# Update image names in:
#   k8s/base/ingestion/deployment.yaml
#   k8s/base/frontend/deployment.yaml

# 3. Deploy
kubectl apply -k k8s/overlays/prod

# 4. Check everything came up
kubectl get pods -n llm-logger
kubectl get svc  -n llm-logger
```

---

## Quick Start — Helm

```bash
# 1. Build and push images (same as above)

# 2. Install
helm install llm-logger ./helm/llm-logger \
  --namespace llm-logger --create-namespace \
  --set ingestion.image.repository=YOUR_REGISTRY/llm-ingestion \
  --set frontend.image.repository=YOUR_REGISTRY/llm-frontend \
  --set secrets.anthropicKey=sk-ant-... \
  --set secrets.groqKey=gsk_...

# Upgrade after code changes
helm upgrade llm-logger ./helm/llm-logger \
  --namespace llm-logger \
  --reuse-values \
  --set ingestion.image.tag=v1.2.0
```

---

## Architecture in Kubernetes

```
                    ┌─────────────────────────────────────────┐
                    │  Namespace: llm-logger                  │
                    │                                         │
Internet ──► Ingress (nginx) ──► frontend-svc (ClusterIP)   │
                    │                │                        │
                    │          frontend Pod(s)                │
                    │          [nginx, React SPA]             │
                    │                │ /api/* proxy           │
                    │          ingestion-svc (ClusterIP)      │
                    │                │                        │
                    │         ingestion Pod(s)                │
                    │         [Express, proxy, ingest]        │
                    │           │            │                │
                    │      postgres-svc   redis-svc           │
                    │           │            │                │
                    │     postgres Pod    redis Pod           │
                    │     [PVC: 10Gi]    [PVC: 1Gi]          │
                    └─────────────────────────────────────────┘
```

---

## Scaling Notes

- **ingestion**: stateless — scale freely (`replicas: 3+`). Redis pub/sub keeps SSE events consistent across replicas.
- **frontend**: static files — scale freely.
- **postgres**: single replica with PVC. For HA, replace with an operator (CloudNativePG, Zalando).
- **redis**: single replica. For HA, use Redis Sentinel or Redis Operator.

---

## Directory Layout

```
k8s/
├── base/
│   ├── ingestion/          deployment, service, secret template, configmap
│   ├── frontend/           deployment, service, configmap (nginx)
│   ├── postgres/           statefulset, service, PVC
│   ├── redis/              deployment, service, PVC
│   ├── ingress.yaml        Ingress for external access
│   └── namespace.yaml      llm-logger namespace
├── overlays/
│   ├── dev/                kustomize patches (1 replica, no resource limits)
│   └── prod/               kustomize patches (3 replicas, resource limits, HPA)
helm/
└── llm-logger/
    ├── Chart.yaml
    ├── values.yaml         all tunables in one place
    └── templates/          one template per resource
```
