---
layout: post
title: "Kubernetes Troubleshooting Handbook: From CrashLoopBackOff to Smooth Sailing"
date: 2025-03-15
categories: [devops]
author: Zhou Xunyou
lang: en
---

Kubernetes troubleshooting is a daily reality for every ops and dev engineer. Pods stuck in CrashLoopBackOff, OOMKilled, ImagePullBackOff — the reasons behind these states vary widely and require a systematic diagnostic approach. This article categorizes failures and provides complete troubleshooting workflows and command cheat sheets.

## Core Troubleshooting Principles

> **Work from the inside out, step by step**: Container → Pod → Service → Ingress → CNI

The most common mistake during troubleshooting is jumping straight to logs while ignoring events and status. The correct order is:

```
1. kubectl get pods — check status
2. kubectl describe pod — check events
3. kubectl logs — check logs
4. kubectl exec — verify inside container
```

## Pod Status Quick Reference

| Status | Meaning | First Command |
|--------|---------|---------------|
| CrashLoopBackOff | Container crashes after starting, repeatedly restarted | `kubectl logs --previous` |
| OOMKilled | Killed for exceeding memory limit | `kubectl describe pod` |
| ImagePullBackOff | Image pull failed | `kubectl describe pod` |
| Pending | Cannot be scheduled to a node | `kubectl describe pod` |
| ContainerCreating | Stuck in creation | `kubectl describe pod` |
| Completed | Container exited normally | Check restartPolicy |
| Error | Container exited abnormally | `kubectl logs` |
| Unknown | Node unreachable | `kubectl get nodes` |

## Troubleshooting CrashLoopBackOff

The most common Pod failure — the container starts then crashes, and Kubernetes keeps restarting it.

### Diagnostic Workflow

```bash
# 1. Check Pod status and restart count
kubectl get pod <pod-name> -o wide

# 2. Check logs from the last crash (critical!)
kubectl logs <pod-name> --previous

# 3. If --previous has nothing, check current logs
kubectl logs <pod-name>

# 4. Check Pod events
kubectl describe pod <pod-name>

# 5. Focus on Warning messages in the Events section
```

### Common Causes and Fixes

**Cause 1: Application startup failure (misconfiguration)**

```bash
# Typical logs
# Error: Config file not found: /etc/app/config.yml
# panic: failed to connect to database

# Diagnosis
kubectl logs <pod-name> --previous | head -50

# Fix: verify ConfigMap/Secret mounts are correct
kubectl get configmap <config-name> -o yaml
kubectl describe pod <pod-name> | grep -A5 Mount
```

**Cause 2: Health check failure**

```bash
# Typical events
# Liveness probe failed: Get "http://:8080/health": dial tcp :8080: connect: connection refused
# Back-off restarting failed container

# Diagnosis
kubectl describe pod <pod-name> | grep -A10 "Events"

# Fix: adjust probe parameters
```

```yaml
# Increase initial delay and timeout
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30  # Give the app enough startup time
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3      # Allow 3 consecutive failures
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
```

**Cause 3: Main process exits immediately**

```bash
# Container starts then exits because the main process ends
# Typical scenario: running a script that completes and exits

# Diagnosis
kubectl logs <pod-name> --previous
# May show script output then termination

# Fix: ensure the main process stays in the foreground
# Use ENTRYPOINT instead of RUN in Dockerfile
# Or add tail -f /dev/null to keep the container running
```

## Troubleshooting OOMKilled

The container's memory usage exceeds its limit and the kernel's OOM Killer terminates it.

### Diagnostic Steps

```bash
# 1. Confirm OOMKilled
kubectl describe pod <pod-name> | grep -A5 "Last State"
# Output: Reason: OOMKilled

# 2. Check memory limits
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].resources}'

# 3. Check actual memory usage
kubectl top pod <pod-name>

# 4. Check node memory
kubectl describe node <node-name> | grep -A10 "Allocated resources"
```

### Fix Options

```yaml
# Option 1: Increase memory limit
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"    # Increase limit
    cpu: "500m"

# Option 2: Optimize application memory usage
# JVM apps: set -Xmx to 70-80% of limit
# Go apps: debug memory leaks
# Node.js: set --max-old-space-size

# Option 3: Set QoS to Guaranteed (requests = limits)
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "512Mi"   # requests = limits
    cpu: "500m"
```

### JVM Application OOM Configuration

```yaml
# Common mistake: JVM heap size exceeds container limit
# Modern JDK (8u191+) supports container awareness

env:
  - name: JAVA_OPTS
    value: >-
      -XX:MaxRAMPercentage=75.0
      -XX:InitialRAMPercentage=50.0
      -XX:+UseContainerSupport
      -XX:+HeapDumpOnOutOfMemoryError
      -XX:HeapDumpPath=/tmp/heapdump.hprof
# Don't hardcode -Xmx; use MaxRAMPercentage for dynamic calculation
```

## Troubleshooting ImagePullBackOff

Image pull failures, typically due to missing images, authentication issues, or network problems.

### Diagnostic Steps

```bash
# 1. Check detailed error
kubectl describe pod <pod-name> | grep -A5 "Events"
# Common errors:
#   Failed to pull image "xxx": rpc error: code = NotFound
#   Failed to pull image "xxx": failed to authorize
#   Failed to pull image "xxx": dial tcp: lookup registry.example.com

# 2. Verify the image exists
docker pull <image-name>  # Test locally

# 3. Check imagePullSecrets
kubectl get secret <secret-name> -o yaml
```

### Common Causes and Fixes

```bash
# Cause 1: Wrong image tag or image doesn't exist
# Fix: confirm the correct tag
kubectl set image deployment/<name> <container>=<image>:<correct-tag>

# Cause 2: Private registry auth failure
# Fix: create imagePullSecret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=password

# Reference in Deployment
# spec.template.spec.imagePullSecrets:
#   - name: regcred

# Cause 3: Network issues (can't reach registry)
# Fix: configure container runtime proxy or mirror
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.configs."docker.io".auth]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
      endpoint = ["https://mirror.gcr.io"]
```

## Troubleshooting Pending Status

The Pod cannot be scheduled to any node.

```bash
# Check scheduling failure reason
kubectl describe pod <pod-name> | grep -A20 "Events"
# Common reasons:
#   0/3 nodes are available: 3 Insufficient cpu
#   0/3 nodes are available: 3 node(s) didn't match Pod's node affinity
#   0/3 nodes are available: 3 Insufficient memory
#   0/3 nodes are available: 3 node(s) had taint {dedicated: true}, pod didn't have toleration

# Check node resources
kubectl top nodes
kubectl describe node <node-name> | grep -A15 "Allocated resources"

# Check Pod resource requests
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].resources.requests}'
```

### Fix Options

```bash
# Insufficient resources:
#   1. Lower requests
#   2. Add nodes
#   3. Clean up unnecessary Pods

# Affinity/anti-affinity not satisfied:
#   Check nodeSelector, affinity configuration

# Taint/toleration mismatch:
#   Add toleration to Pod or remove node taint
kubectl taint nodes <node-name> dedicated-  # Remove taint
```

## Network Troubleshooting

Network issues are the hardest to diagnose — they require a layered approach.

### In-Pod Network Diagnostics

```bash
# Enter Pod to check DNS
kubectl exec -it <pod-name> -- nslookup kubernetes.default
kubectl exec -it <pod-name> -- nslookup <service-name>.<namespace>.svc.cluster.local

# Check Service connectivity
kubectl exec -it <pod-name> -- curl -v http://<service-name>:<port>/health

# Check external network
kubectl exec -it <pod-name> -- curl -v https://google.com

# Temporary debug Pod (if target Pod lacks curl)
kubectl run debug --image=busybox -it --rm -- sh
# Run wget/curl/nslookup inside
```

### Service Diagnostics

```bash
# 1. Check if Service has Endpoints
kubectl get endpoints <service-name>
# Empty → label selector mismatch

# 2. Compare labels
kubectl get pods -l app=my-app --show-labels
kubectl get svc <service-name> -o jsonpath='{.spec.selector}'

# 3. Check Service type
kubectl get svc <service-name> -o wide

# 4. Test direct ClusterIP access
kubectl exec -it <any-pod> -- curl http://<cluster-ip>:<port>/
```

### CNI Troubleshooting

```bash
# Check CNI plugin status
ls /etc/cni/net.d/
ls /opt/cni/bin/

# Common CNI issues
# Calico:
kubectl get pods -n kube-system -l k8s-app=calico-node
kubectl logs -n kube-system -l k8s-app=calico-node

# Flannel:
kubectl get pods -n kube-system -l app=flannel
kubectl logs -n kube-system -l app=flannel

# Check iptables rules
iptables -t nat -L KUBE-SERVICES | head -20

# Check node routes
ip route show
```

## kubectl Troubleshooting Cheat Sheet

```bash
# === Resource Overview ===
kubectl get all -n <namespace>                    # View all resources
kubectl get pods -A -o wide                       # Pods across all namespaces
kubectl get events --sort-by='.lastTimestamp'      # Events sorted by time
kubectl api-resources                             # Available resource types

# === Pod Debugging ===
kubectl describe pod <pod>                        # Pod details and events
kubectl logs <pod> -c <container>                 # Specific container logs
kubectl logs <pod> --previous                     # Logs from last crash
kubectl logs <pod> -f --tail=100                  # Follow last 100 lines
kubectl logs -l app=my-app --all-containers       # All container logs by label
kubectl exec -it <pod> -- /bin/sh                 # Enter container
kubectl port-forward <pod> 8080:80                # Port forward

# === Node Debugging ===
kubectl describe node <node>                      # Node details
kubectl top nodes                                 # Node resource usage
kubectl get nodes -o wide                         # Node status
kubectl cordon <node>                             # Mark node unschedulable
kubectl drain <node> --ignore-daemonsets          # Drain Pods

# === Network Debugging ===
kubectl get svc,endpoints,pods -l app=my-app      # Correlated view
kubectl run tmp --image=busybox -it --rm -- sh    # Temporary debug Pod

# === Advanced ===
kubectl get pod <pod> -o yaml                     # Full YAML
kubectl explain pod.spec.containers               # API documentation
kubectl diff -f deployment.yaml                   # Preview changes
```

## Log Aggregation Tips

```bash
# Use stern to aggregate multi-Pod logs (more powerful than kubectl logs -l)
# Install: brew install stern

# Track all Pod logs for a specific Deployment
stern my-app -n production

# Regex filtering
stern my-app -n production --pattern "ERROR|WARN"

# Multiple namespaces
stern my-app -n staging,production

# JSON output format
stern my-app -o json

# Filter with kubectl jsonpath
kubectl logs -l app=my-app --tail=100 | jq 'select(.level=="error")'
```

## Common Pitfalls

### 1. Ignoring initContainer Failures

```bash
# Pod stuck at Init:0/2, but describe may not make it obvious
kubectl describe pod <pod> | grep -A10 "Init Containers"

# Check initContainer logs
kubectl logs <pod> -c <init-container-name>
```

### 2. Ignoring Resource Quota Limits

```bash
# Pod creation fails but isn't Pending
# Error might be in namespace ResourceQuota or LimitRange
kubectl describe resourcequota -n <namespace>
kubectl describe limitrange -n <namespace>
```

### 3. Unbound PVC Causing Pod to Hang

```bash
# Pod stuck at ContainerCreating
kubectl describe pod <pod> | grep -A5 "Volumes"
kubectl get pvc
# If PVC is Pending, check StorageClass and PV
kubectl describe pvc <pvc-name>
```

## Conclusion

Kubernetes troubleshooting requires systematic thinking:

- **Status first, logs second**: Events in `describe` are often more diagnostic than logs
- **Inside out**: Container → Pod → Service → Ingress, layer by layer
- **Use `--previous`**: Always check the previous crash log for CrashLoopBackOff
- **Watch resources**: OOMKilled and Pending are mostly resource issues
- **Network layers**: DNS → Service → CNI → External network

Remember the golden rule: **don't guess — use data**. Collect information first (status, events, logs), then identify the root cause, and finally fix and verify.
