# ACK phase-1 deployment

These manifests are a production starting point, not customer-ready values. Replace all
`replace-*` and `registry.example.com` values before applying them.

## Images

```bash
docker build -t <acr>/musedam-auto-tagging-web:<version> \
  --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<customer-specific-key> .
docker build -f Dockerfile.scheduler -t <acr>/musedam-auto-tagging-scheduler:<version> .
docker build -f Dockerfile.job -t <acr>/musedam-auto-tagging-migration:<version> .
```

Push all three images to the customer ACR and replace their names in the manifests.

## Apply order

1. Create the namespace: `kubectl create namespace musedam-auto-tagging-prod`.
2. Create the Secret from an out-of-repository customer secret source. `secret.example.yaml`
   is a key-name template only; do not commit a populated copy.
3. Back up the target database.
4. Copy `migration-job.example.yaml`, give the Job a unique versioned name, apply it, and wait
   for successful completion.
5. Replace the ConfigMap values and image names, then apply `base.yaml`.
6. Adapt and apply `ingress.example.yaml` to the ingress controller installed in the customer
   ACK cluster.

The Web deployment intentionally has one replica in phase 1. The current queue concurrency
guard is process-local; do not scale Web horizontally before the worker/concurrency refactor.

The daily CronJob uses `timeZone: Asia/Shanghai`. Confirm the customer ACK Kubernetes version
supports CronJob time zones before applying. If it does not, remove `timeZone` and use the UTC
equivalent schedule (`0 16 * * *`).
