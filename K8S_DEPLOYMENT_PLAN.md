# Kubernetes Deployment Plan

## Overview

Deploy multi-tenant Uptime Kuma to Kubernetes with high availability, horizontal scaling, and production-grade observability.

---

## Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    Kubernetes Cluster                    │
                    │                                                          │
┌──────────┐        │  ┌─────────────┐     ┌─────────────────────────────┐   │
│  Users   │───────▶│  │   Ingress   │────▶│     App Deployment          │   │
│          │  HTTPS │  │  (nginx +   │     │  ┌─────┐ ┌─────┐ ┌─────┐   │   │
└──────────┘        │  │   TLS)      │     │  │Pod 1│ │Pod 2│ │Pod 3│   │   │
                    │  └─────────────┘     │  └──┬──┘ └──┬──┘ └──┬──┘   │   │
                    │                      │     │       │       │       │   │
                    │                      └─────┼───────┼───────┼───────┘   │
                    │                            │       │       │           │
                    │                      ┌─────▼───────▼───────▼─────┐     │
                    │                      │     Redis (Socket.IO      │     │
                    │                      │     adapter + cache)      │     │
                    │                      └───────────────────────────┘     │
                    │                                   │                     │
                    │                      ┌────────────▼────────────┐       │
                    │                      │      PostgreSQL         │       │
                    │                      │   (managed or in-cluster)│       │
                    │                      └─────────────────────────┘       │
                    │                                                          │
                    └─────────────────────────────────────────────────────────┘
```

---

## Prerequisites (Code Changes Required)

### 1. Health Endpoints for Main Server

**Current State:** Workers have health endpoints, main server does not.

**Required:** Add to `server/server.js`:
- `GET /health` - Liveness probe (process alive)
- `GET /ready` - Readiness probe (DB + Redis connected)

### 2. Socket.IO Redis Adapter

**Current State:** Not implemented - limits to single replica.

**Required:** Add `@socket.io/redis-adapter` for horizontal scaling:
```javascript
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
```

This allows any pod to emit events to any connected client.

---

## Kubernetes Resources

### Directory Structure

```
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml              # Template (use SealedSecrets/ExternalSecrets in prod)
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml                 # HorizontalPodAutoscaler
│   └── pdb.yaml                 # PodDisruptionBudget
├── overlays/
│   ├── dev/
│   │   ├── kustomization.yaml
│   │   ├── postgres.yaml        # In-cluster PostgreSQL
│   │   └── redis.yaml           # In-cluster Redis
│   └── production/
│       ├── kustomization.yaml
│       ├── configmap-patch.yaml
│       ├── ingress-patch.yaml
│       └── external-secret.yaml # ExternalSecretsOperator
└── docker/
    └── Dockerfile.prod
```

---

## Resource Specifications

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: uptime-kuma
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
      - name: app
        image: uptime-kuma-mt:latest
        ports:
        - containerPort: 3001
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
        startupProbe:
          httpGet:
            path: /health
            port: 3001
          failureThreshold: 30
          periodSeconds: 10
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 10"]
```

### Ingress (nginx)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: uptime-kuma
  annotations:
    # WebSocket support
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    # Sticky sessions for Socket.IO (fallback if Redis adapter fails)
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "SERVERID"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "3600"
    # TLS
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - status.example.com
    secretName: uptime-kuma-tls
  rules:
  - host: status.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: uptime-kuma
            port:
              number: 3001
```

### HorizontalPodAutoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: uptime-kuma
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: uptime-kuma
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## Environment Variables

### ConfigMap (non-sensitive)

```yaml
data:
  UPTIME_KUMA_DB_TYPE: "postgres"
  UPTIME_KUMA_DB_PORT: "5432"
  UPTIME_KUMA_DB_NAME: "uptime_kuma"
  MULTI_TENANT: "true"
  NODE_ENV: "production"
  APP_URL: "https://status.example.com"
```

### Secret (sensitive)

```yaml
stringData:
  UPTIME_KUMA_DB_HOSTNAME: "postgres-host"
  UPTIME_KUMA_DB_USERNAME: "uptime_kuma"
  UPTIME_KUMA_DB_PASSWORD: "<db-password>"
  REDIS_URL: "redis://:password@redis-host:6379"
  SMTP_HOST: "smtp.example.com"
  SMTP_PORT: "587"
  SMTP_USER: "noreply@example.com"
  SMTP_PASS: "<smtp-password>"
  SMTP_FROM: "Uptime Kuma <noreply@example.com>"
```

---

## Database Strategy

### Option A: Managed PostgreSQL (Recommended for Production)

| Provider | Service | Notes |
|----------|---------|-------|
| AWS | RDS PostgreSQL | Enable Multi-AZ for HA |
| GCP | Cloud SQL | Enable HA configuration |
| Azure | Azure Database for PostgreSQL | Flexible Server |
| DigitalOcean | Managed Databases | Simple pricing |

### Option B: In-Cluster (Dev/Staging)

Use Bitnami PostgreSQL Helm chart:
```bash
helm install postgresql bitnami/postgresql \
  --set auth.postgresPassword=<password> \
  --set auth.database=uptime_kuma \
  --set primary.persistence.size=10Gi
```

### Option C: PostgreSQL Operator (Self-Managed Production)

- CloudNativePG (recommended)
- Zalando PostgreSQL Operator
- CrunchyData PGO

---

## Redis Strategy

### Option A: Managed Redis (Recommended)

| Provider | Service |
|----------|---------|
| AWS | ElastiCache |
| GCP | Memorystore |
| Azure | Azure Cache for Redis |

### Option B: In-Cluster

```bash
helm install redis bitnami/redis \
  --set auth.enabled=false \
  --set architecture=standalone
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Build and push Docker image
      uses: docker/build-push-action@v5
      with:
        context: .
        file: ./docker/Dockerfile.prod
        push: ${{ github.event_name != 'pull_request' }}
        tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Deploy to Kubernetes
      run: |
        cd k8s/overlays/production
        kustomize edit set image uptime-kuma=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
        kustomize build . | kubectl apply -f -
```

---

## Implementation Order

| Phase | Task | Priority |
|-------|------|----------|
| 1 | Add health endpoints to server.js | High |
| 2 | Add Socket.IO Redis adapter | High |
| 3 | Create production Dockerfile | High |
| 4 | Create K8s base manifests | High |
| 5 | Create dev overlay (in-cluster DB) | Medium |
| 6 | Create production overlay | Medium |
| 7 | Create GitHub Actions workflow | Medium |
| 8 | Add Prometheus metrics endpoint | Low |
| 9 | Add network policies | Low |

---

## Deployment Commands

### Development
```bash
# Apply dev overlay (includes in-cluster postgres/redis)
kubectl apply -k k8s/overlays/dev
```

### Production
```bash
# Apply production overlay (uses external managed services)
kubectl apply -k k8s/overlays/production
```

### Rollback
```bash
kubectl rollout undo deployment/uptime-kuma
```

### Scale
```bash
kubectl scale deployment/uptime-kuma --replicas=5
```

---

## Monitoring & Observability

### Recommended Stack
- **Metrics:** Prometheus + Grafana
- **Logs:** Loki or ELK stack
- **Tracing:** Jaeger (optional)

### Key Metrics to Monitor
- Pod CPU/Memory usage
- Request latency (P50, P95, P99)
- WebSocket connection count
- Database connection pool
- Redis connection health
- Monitor check success/failure rates

---

## Security Considerations

1. **Network Policies:** Restrict pod-to-pod communication
2. **Pod Security Standards:** Run as non-root, read-only filesystem
3. **Secrets:** Use External Secrets Operator or Sealed Secrets
4. **RBAC:** Minimal service account permissions
5. **Image Scanning:** Scan images in CI pipeline (Trivy, Snyk)

---

## Cost Estimation (AWS Example)

| Component | Instance | Monthly Cost |
|-----------|----------|--------------|
| EKS Cluster | 1 cluster | ~$73 |
| Worker Nodes | 3x t3.medium | ~$90 |
| RDS PostgreSQL | db.t3.small | ~$30 |
| ElastiCache Redis | cache.t3.micro | ~$12 |
| ALB | 1 load balancer | ~$22 |
| **Total** | | **~$227/month** |

*Costs vary by region and usage.*
