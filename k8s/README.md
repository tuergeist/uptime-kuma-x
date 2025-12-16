# Kubernetes Deployment

This directory contains Kubernetes manifests for deploying UptimeHive.

## Directory Structure

```
k8s/
├── base/                    # Base resources (shared across environments)
│   ├── deployment.yaml      # Main app deployment
│   ├── worker-deployment.yaml
│   ├── redis-deployment.yaml
│   ├── postgresql-deployment.yaml
│   ├── backup-cronjob.yaml  # Daily database backup
│   └── kustomization.yaml
├── overlays/
│   ├── staging/             # Staging environment
│   │   ├── pre-deploy-backup-job.yaml
│   │   └── kustomization.yaml
│   └── production/          # Production environment
│       ├── pre-deploy-backup-job.yaml
│       └── kustomization.yaml
```

## S3 Backup Configuration

Database backups are stored in AWS S3.

### AWS Resources

| Resource | Value |
|----------|-------|
| Bucket | `uptimehive-backups` |
| Region | `eu-central-1` |
| IAM User | `uptimehive-backup-writer` |
| IAM Policy | `UptimehiveBackupAccess` (inline) |

### Bucket Structure

```
uptimehive-backups/
├── staging/           # Staging backups (prefix: staging/)
│   ├── pre_deploy_staging_YYYYMMDD_HHMMSS.sql.gz
│   └── uptimehive_YYYYMMDD_HHMMSS.sql.gz
└── production/        # Production backups (prefix: production/)
    ├── pre_deploy_production_YYYYMMDD_HHMMSS.sql.gz
    └── uptimehive_YYYYMMDD_HHMMSS.sql.gz
```

### IAM Policy

The `uptimehive-backup-writer` IAM user has an inline policy that grants:
- `s3:PutObject` - Upload backups
- `s3:GetObject` - Download backups (for restore)
- `s3:DeleteObject` - Cleanup old backups
- `s3:ListBucket` - List backup files

Scoped to only the `uptimehive-backups` bucket.

### GitHub Secrets Required

The following secrets must be configured in GitHub for deployments:

| Secret | Environment | Description |
|--------|-------------|-------------|
| `STAGING_S3_ACCESS_KEY` | staging | AWS access key ID |
| `STAGING_S3_SECRET_KEY` | staging | AWS secret access key |
| `PRODUCTION_S3_ACCESS_KEY` | production | AWS access key ID |
| `PRODUCTION_S3_SECRET_KEY` | production | AWS secret access key |
| `KUBECONFIG` | both | Base64-encoded kubeconfig |

### Backup Schedule

- **Daily CronJob**: Runs at 2:00 AM UTC via `backup-cronjob.yaml`
- **Pre-deployment**: Runs before each deployment via ArgoCD PreSync hook

### Retention Policy

- S3: 30 days (auto-cleanup via minio/mc)
- Local: 3 days (for quick restore)

## Regenerating S3 Credentials

If credentials need to be rotated:

```bash
# Use AWS profile chbecker
export AWS_PROFILE=chbecker

# Delete old access key (if exists)
aws iam list-access-keys --user-name uptimehive-backup-writer
aws iam delete-access-key --user-name uptimehive-backup-writer --access-key-id <OLD_KEY_ID>

# Create new access key
aws iam create-access-key --user-name uptimehive-backup-writer

# Update GitHub secrets
gh secret set STAGING_S3_ACCESS_KEY --body "<new-access-key-id>"
gh secret set STAGING_S3_SECRET_KEY --body "<new-secret-access-key>"
gh secret set PRODUCTION_S3_ACCESS_KEY --body "<new-access-key-id>"
gh secret set PRODUCTION_S3_SECRET_KEY --body "<new-secret-access-key>"
```

## Deploying

### Staging (automatic)

Staging deploys automatically when changes are pushed to `master` branch.

### Production (manual)

Production deploys when a version tag is pushed:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Or trigger manually via GitHub Actions workflow dispatch.
