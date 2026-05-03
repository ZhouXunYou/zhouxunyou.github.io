---
layout: post
title: "Kubernetes 排障手册：从 CrashLoopBackOff 到丝滑运行"
date: 2025-03-15
categories: [devops, kubernetes]
author: Zhou Xunyou
lang: zh
---

Kubernetes 排障是每个运维和开发人员的日常。Pod 卡在 CrashLoopBackOff、OOMKilled、ImagePullBackOff……这些状态背后的原因各不相同，需要系统化的诊断方法。本文将按照故障分类，给出完整的排查流程和命令速查表。

## 排障核心原则

> **从内到外，逐步排查**：Container → Pod → Service → Ingress → CNI

排障时最常见的错误是直接去看日志，而忽略了事件和状态。正确的顺序是：

```
1. kubectl get pods — 看状态
2. kubectl describe pod — 看事件
3. kubectl logs — 看日志
4. kubectl exec — 进容器确认
```

## Pod 异常状态速查

| 状态 | 含义 | 首要排查命令 |
|------|------|-------------|
| CrashLoopBackOff | 容器启动后崩溃，反复重启 | `kubectl logs --previous` |
| OOMKilled | 内存超限被杀 | `kubectl describe pod` |
| ImagePullBackOff | 镜像拉取失败 | `kubectl describe pod` |
| Pending | 无法调度到节点 | `kubectl describe pod` |
| ContainerCreating | 一直创建中 | `kubectl describe pod` |
| Completed | 容器正常退出 | 检查 restartPolicy |
| Error | 容器异常退出 | `kubectl logs` |
| Unknown | 节点失联 | `kubectl get nodes` |

## CrashLoopBackOff 排查

最常见的 Pod 故障，容器启动后崩溃，Kubernetes 不断重启它。

### 排查流程

```bash
# 1. 查看 Pod 状态和重启次数
kubectl get pod <pod-name> -o wide

# 2. 查看上一次崩溃的日志（关键！）
kubectl logs <pod-name> --previous

# 3. 如果 --previous 也没有，看当前日志
kubectl logs <pod-name>

# 4. 查看 Pod 事件
kubectl describe pod <pod-name>

# 5. 关注 Events 部分的 Warning 信息
```

### 常见原因及修复

**原因一：应用启动失败（配置错误）**

```bash
# 典型日志
# Error: Config file not found: /etc/app/config.yml
# panic: failed to connect to database

# 诊断
kubectl logs <pod-name> --previous | head -50

# 修复：检查 ConfigMap/Secret 是否正确挂载
kubectl get configmap <config-name> -o yaml
kubectl describe pod <pod-name> | grep -A5 Mount
```

**原因二：健康检查失败**

```bash
# 典型事件
# Liveness probe failed: Get "http://:8080/health": dial tcp :8080: connect: connection refused
# Back-off restarting failed container

# 诊断
kubectl describe pod <pod-name> | grep -A10 "Events"

# 修复：调整探针参数
```

```yaml
# 增加初始延迟和超时时间
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30  # 给应用足够的启动时间
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3      # 允许连续失败 3 次
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
```

**原因三：主进程前台运行问题**

```bash
# 容器启动后立即退出，因为主进程结束了
# 典型场景：运行一个脚本后退出

# 诊断
kubectl logs <pod-name> --previous
# 可能看到脚本输出后就结束了

# 修复：确保主进程保持前台运行
# Dockerfile 中使用 ENTRYPOINT 而非 RUN
# 或者添加 tail -f /dev/null 保持容器运行
```

## OOMKilled 排查

容器内存使用超出 limit，被内核 OOM Killer 杀掉。

### 诊断步骤

```bash
# 1. 确认是否 OOMKilled
kubectl describe pod <pod-name> | grep -A5 "Last State"
# 输出：Reason: OOMKilled

# 2. 查看内存 limit
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].resources}'

# 3. 查看实际内存使用
kubectl top pod <pod-name>

# 4. 查看节点内存情况
kubectl describe node <node-name> | grep -A10 "Allocated resources"
```

### 修复方案

```yaml
# 方案一：增加 memory limit
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"    # 增大 limit
    cpu: "500m"

# 方案二：优化应用内存使用
# JVM 应用：设置 -Xmx 为 limit 的 70-80%
# Go 应用：调试内存泄漏
# Node.js：设置 --max-old-space-size

# 方案三：设置 QoS 为 Guaranteed（requests = limits）
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "512Mi"   # requests = limits
    cpu: "500m"
```

### JVM 应用的 OOM 配置

```yaml
# 常见错误：JVM 堆大小超过容器 limit
# 现代 JDK（8u191+）支持容器感知

env:
  - name: JAVA_OPTS
    value: >-
      -XX:MaxRAMPercentage=75.0
      -XX:InitialRAMPercentage=50.0
      -XX:+UseContainerSupport
      -XX:+HeapDumpOnOutOfMemoryError
      -XX:HeapDumpPath=/tmp/heapdump.hprof
# 不要用 -Xmx 硬编码，用 MaxRAMPercentage 动态计算
```

## ImagePullBackOff 排查

镜像拉取失败，通常是因为镜像不存在、权限问题或网络问题。

### 诊断步骤

```bash
# 1. 查看详细错误
kubectl describe pod <pod-name> | grep -A5 "Events"
# 常见错误：
#   Failed to pull image "xxx": rpc error: code = NotFound
#   Failed to pull image "xxx": failed to authorize
#   Failed to pull image "xxx": dial tcp: lookup registry.example.com

# 2. 确认镜像是否存在
docker pull <image-name>  # 在本地测试

# 3. 检查 imagePullSecrets
kubectl get secret <secret-name> -o yaml
```

### 常见原因修复

```bash
# 原因一：镜像标签错误或不存在
# 修复：确认镜像标签
kubectl set image deployment/<name> <container>=<image>:<correct-tag>

# 原因二：私有仓库认证失败
# 修复：创建 imagePullSecret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=password

# 在 Deployment 中引用
# spec.template.spec.imagePullSecrets:
#   - name: regcred

# 原因三：网络问题（无法访问仓库）
# 修复：配置容器运行时的代理或 mirror
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.configs."docker.io".auth]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
      endpoint = ["https://mirror.gcr.io"]
```

## Pending 状态排查

Pod 无法被调度到任何节点。

```bash
# 查看调度失败原因
kubectl describe pod <pod-name> | grep -A20 "Events"
# 常见原因：
#   0/3 nodes are available: 3 Insufficient cpu
#   0/3 nodes are available: 3 node(s) didn't match Pod's node affinity
#   0/3 nodes are available: 3 Insufficient memory
#   0/3 nodes are available: 3 node(s) had taint {dedicated: true}, pod didn't have toleration

# 查看节点资源
kubectl top nodes
kubectl describe node <node-name> | grep -A15 "Allocated resources"

# 查看 Pod 的资源请求
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].resources.requests}'
```

### 修复方案

```bash
# 资源不足：
#   1. 降低 requests
#   2. 扩容节点
#   3. 清理不需要的 Pod

# 亲和性/反亲和性不满足：
#   检查 nodeSelector、affinity 配置

# 污点/容忍不匹配：
#   给 Pod 添加 toleration 或移除节点污点
kubectl taint nodes <node-name> dedicated-  # 移除污点
```

## 网络排障

网络问题是最难排查的，需要分层诊断。

### Pod 内网络诊断

```bash
# 进入 Pod 检查 DNS
kubectl exec -it <pod-name> -- nslookup kubernetes.default
kubectl exec -it <pod-name> -- nslookup <service-name>.<namespace>.svc.cluster.local

# 检查 Service 连通性
kubectl exec -it <pod-name> -- curl -v http://<service-name>:<port>/health

# 检查外部网络
kubectl exec -it <pod-name> -- curl -v https://google.com

# 临时调试 Pod（如果目标 Pod 没有 curl）
kubectl run debug --image=busybox -it --rm -- sh
# 在里面执行 wget/curl/nslookup
```

### Service 诊断

```bash
# 1. 检查 Service 是否有 Endpoints
kubectl get endpoints <service-name>
# 如果为空 → 标签选择器不匹配

# 2. 对比标签
kubectl get pods -l app=my-app --show-labels
kubectl get svc <service-name> -o jsonpath='{.spec.selector}'

# 3. 检查 Service 类型
kubectl get svc <service-name> -o wide

# 4. 直接访问 ClusterIP 测试
kubectl exec -it <any-pod> -- curl http://<cluster-ip>:<port>/
```

### CNI 排障

```bash
# 检查 CNI 插件状态
ls /etc/cni/net.d/
ls /opt/cni/bin/

# 常见 CNI 问题
# Calico：
kubectl get pods -n kube-system -l k8s-app=calico-node
kubectl logs -n kube-system -l k8s-app=calico-node

# Flannel：
kubectl get pods -n kube-system -l app=flannel
kubectl logs -n kube-system -l app=flannel

# 检查 iptables 规则
iptables -t nat -L KUBE-SERVICES | head -20

# 检查节点路由
ip route show
```

## kubectl 排障命令速查表

```bash
# === 资源查看 ===
kubectl get all -n <namespace>                    # 查看所有资源
kubectl get pods -A -o wide                       # 所有命名空间的 Pod
kubectl get events --sort-by='.lastTimestamp'      # 按时间排序的事件
kubectl api-resources                             # 查看可用资源类型

# === Pod 排查 ===
kubectl describe pod <pod>                        # Pod 详情和事件
kubectl logs <pod> -c <container>                 # 指定容器日志
kubectl logs <pod> --previous                     # 上次崩溃的日志
kubectl logs <pod> -f --tail=100                  # 实时跟踪最后100行
kubectl logs -l app=my-app --all-containers       # 按标签查所有容器日志
kubectl exec -it <pod> -- /bin/sh                 # 进入容器
kubectl port-forward <pod> 8080:80                # 端口转发

# === 节点排查 ===
kubectl describe node <node>                      # 节点详情
kubectl top nodes                                 # 节点资源使用
kubectl get nodes -o wide                         # 节点状态
kubectl cordon <node>                             # 标记节点不可调度
kubectl drain <node> --ignore-daemonsets          # 驱逐 Pod

# === 网络排查 ===
kubectl get svc,endpoints,pods -l app=my-app      # 关联查看
kubectl run tmp --image=busybox -it --rm -- sh    # 临时调试 Pod

# === 高级 ===
kubectl get pod <pod> -o yaml                     # 完整 YAML
kubectl explain pod.spec.containers               # 查看 API 文档
kubectl diff -f deployment.yaml                   # 预览变更
```

## 日志聚合技巧

```bash
# 使用 stern 聚合多 Pod 日志（比 kubectl logs -l 更强大）
# 安装：brew install stern

# 跟踪特定 Deployment 的所有 Pod 日志
stern my-app -n production

# 正则过滤
stern my-app -n production --pattern "ERROR|WARN"

# 多命名空间
stern my-app -n staging,production

# 输出 JSON 格式
stern my-app -o json

# 使用 kubectl 的 jsonpath 过滤
kubectl logs -l app=my-app --tail=100 | jq 'select(.level=="error")'
```

## 常见陷阱

### 1. 忽略 initContainer 失败

```bash
# Pod 一直卡在 Init:0/2，但 describe 可能不明显
kubectl describe pod <pod> | grep -A10 "Init Containers"

# 查看 initContainer 日志
kubectl logs <pod> -c <init-container-name>
```

### 2. 忽略资源配额限制

```bash
# Pod 创建失败但不是 Pending
# 错误可能在 namespace 的 ResourceQuota 或 LimitRange
kubectl describe resourcequota -n <namespace>
kubectl describe limitrange -n <namespace>
```

### 3. PVC 未绑定导致 Pod 卡住

```bash
# Pod 一直 ContainerCreating
kubectl describe pod <pod> | grep -A5 "Volumes"
kubectl get pvc
# 如果 PVC 是 Pending，检查 StorageClass 和 PV
kubectl describe pvc <pvc-name>
```

## 总结

Kubernetes 排障是一项需要系统化思维的技能：

- **先看状态，再看日志**：`describe` 中的 Events 往往比日志更有诊断价值
- **从内到外**：Container → Pod → Service → Ingress，逐层排查
- **善用 `--previous`**：CrashLoopBackOff 一定要看上一次的日志
- **关注资源**：OOMKilled 和 Pending 大多是资源问题
- **网络分层**：DNS → Service → CNI → 外部网络

记住排障的黄金法则：**不要猜测，用数据说话**。先收集信息（状态、事件、日志），再定位根因，最后修复验证。
