---
layout: post
title: "GitHub Actions 进阶：构建高效 CI/CD 流水线"
date: 2025-04-01
categories: [devops, cicd]
author: Zhou Xunyou
lang: zh
---

{% raw %}
GitHub Actions 是目前最流行的 CI/CD 平台之一，但许多团队只用了它最基本的功能——跑测试、构建镜像。本文将深入讲解 GitHub Actions 的高级特性，包括矩阵构建、可复用工作流、缓存策略、安全最佳实践和性能优化，帮助你构建真正高效的 CI/CD 流水线。

## 矩阵构建：一次配置，多环境验证

矩阵策略让你可以用一个 workflow 同时在多种环境中运行测试：

### 基础矩阵

```yaml
name: Matrix Build

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false  # 一个失败不影响其他
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20, 22]
        exclude:
          - os: macos-latest
            node-version: 18  # macOS 不测 Node 18
        include:
          - os: ubuntu-latest
            node-version: 22
            experimental: true  # 额外变量
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

### 动态矩阵：根据代码变更决定构建目标

```yaml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.filter.outputs.changes }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            frontend:
              - 'frontend/**'
            backend:
              - 'backend/**'
            shared:
              - 'shared/**'

  build:
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: ${{ fromJson(needs.detect-changes.outputs.packages || '[]') }}
    steps:
      - uses: actions/checkout@v4
      - run: |
          echo "Building ${{ matrix.package }}"
          cd ${{ matrix.package }} && make build
```

## 可复用工作流

将公共逻辑抽取为可复用工作流，避免在多个仓库中重复定义。

### 定义可复用工作流

```yaml
# .github/workflows/deploy.yml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
      deploy-url:
        required: false
        type: string
        default: ''
    secrets:
      deploy-key:
        required: true
      registry-token:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.registry-token }}

      - name: Deploy
        run: |
          echo "Deploying ${{ inputs.image-tag }} to ${{ inputs.environment }}"
          # 部署逻辑...

      - name: Notify
        if: always()
        run: |
          echo "Deployment ${{ job.status }} for ${{ inputs.environment }}"
```

### 调用可复用工作流

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build
      - run: make test

  deploy-staging:
    needs: build
    uses: ./.github/workflows/deploy.yml
    with:
      environment: staging
      image-tag: ${{ github.sha }}
    secrets:
      deploy-key: ${{ secrets.STAGING_DEPLOY_KEY }}
      registry-token: ${{ secrets.GITHUB_TOKEN }}

  deploy-production:
    needs: deploy-staging
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
      image-tag: ${{ github.sha }}
    secrets:
      deploy-key: ${{ secrets.PROD_DEPLOY_KEY }}
      registry-token: ${{ secrets.GITHUB_TOKEN }}
```

### 跨仓库复用

```yaml
# 从另一个仓库调用
jobs:
  deploy:
    uses: my-org/shared-workflows/.github/workflows/deploy.yml@v1
    with:
      environment: production
    secrets: inherit
```

## 缓存策略

缓存是加速 CI 的最有效手段，但用错缓存比不用更糟。

### 依赖缓存

```yaml
# Node.js 缓存
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: 'npm'  # 自动缓存 node_modules

# Go 缓存
- uses: actions/setup-go@v5
  with:
    go-version: '1.22'
    cache: true

# 手动缓存（更灵活）
- name: Cache pip
  uses: actions/cache@v4
  with:
    path: |
      ~/.cache/pip
      ~/.local/lib/python3.*/site-packages
    key: pip-${{ runner.os }}-${{ hashFiles('requirements*.txt') }}
    restore-keys: |
      pip-${{ runner.os }}-
```

### Docker 层缓存

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Cache Docker layers
        uses: actions/cache@v4
        with:
          path: /tmp/.buildx-cache
          key: buildx-${{ runner.os }}-${{ github.sha }}
          restore-keys: |
            buildx-${{ runner.os }}-

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=local,src=/tmp/.buildx-cache
          cache-to: type=local,dest=/tmp/.buildx-cache-new,mode=max

      # 交换缓存目录，避免缓存无限增长
      - name: Move cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache
```

### 缓存最佳实践

```yaml
# 1. 使用 hashFiles 作为缓存 key，依赖变化时自动失效
key: deps-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

# 2. 设置 restore-keys 作为降级，部分命中也比没有好
restore-keys: |
  deps-${{ runner.os }}-

# 3. 注意缓存大小限制（10GB/仓库）
# 过大的缓存反而降低恢复速度

# 4. 多路径缓存
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      ~/.cache/node
      node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
```

## 自定义 Action

### Composite Action：组合多个步骤

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Install dependencies and build'
inputs:
  node-version:
    description: 'Node.js version'
    default: '22'
  build-args:
    description: 'Build arguments'
    default: ''

runs:
  using: 'composite'
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'

    - name: Install dependencies
      shell: bash
      run: npm ci

    - name: Build
      shell: bash
      run: npm run build ${{ inputs.build-args }}

# 使用
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-project
        with:
          node-version: '20'
```

### JavaScript Action：更灵活的逻辑

```javascript
// action.yml
// name: 'PR Size Labeler'
// runs:
//   using: 'node20'
//   main: 'dist/index.js'

const core = require('@actions/core');
const github = require('@actions/core');

async function run() {
  const { pull_request } = github.context.payload;
  if (!pull_request) {
    core.setFailed('This action only works on pull requests');
    return;
  }

  const additions = pull_request.additions;
  const deletions = pull_request.deletions;
  const total = additions + deletions;

  let label;
  if (total < 50) label = 'size/S';
  else if (total < 200) label = 'size/M';
  else if (total < 500) label = 'size/L';
  else label = 'size/XL';

  core.setOutput('label', label);
  core.setOutput('total_changes', total);
}

run();
```

## 安全最佳实践

### OIDC 认证：告别长期密钥

```yaml
# 不再需要存储 AWS_ACCESS_KEY_ID 等长期密钥
# 使用 OIDC 获取临时凭证

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # 必须！
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeploy
          aws-region: ap-southeast-1
          # 无需 access-key-id 和 secret-access-key！

      - name: Deploy to EKS
        run: |
          kubectl apply -f k8s/
```

### Secrets 管理

```yaml
# 1. 使用 GitHub Secrets 存储敏感信息
# Settings → Secrets and variables → Actions

# 2. 使用 Environment Secrets（需要审批）
# 适合生产环境部署

jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment:
      name: production
      # 需要审批人确认
      # protection_rules:
      #   required_reviewers: ['team-lead']
    steps:
      - run: echo "Deploying with ${{ secrets.DEPLOY_KEY }}"

# 3. 避免在日志中泄露 Secrets
- name: Safe output
  run: |
    # 错误：echo "${{ secrets.MY_SECRET }}"  # 可能出现在日志
    # 正确：使用环境变量
    echo "::add-mask::$MY_SECRET"
    # GitHub 自动遮盖已知 secret 的值
  env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
```

### 最小权限原则

```yaml
# 为每个 job 设置最小权限
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read       # 只读代码
      packages: write      # 写入包

  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write      # OIDC

# 全局默认最小权限（推荐）
permissions:
  contents: read
```

## Monorepo 模式

### 变更检测 + 条件执行

```yaml
name: Monorepo CI

on: [push, pull_request]

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      frontend: ${{ steps.filter.outputs.frontend }}
      backend: ${{ steps.filter.outputs.backend }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            frontend:
              - 'frontend/**'
              - 'shared/**'
            backend:
              - 'backend/**'
              - 'shared/**'
              - 'go.mod'

  frontend-test:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - working-directory: frontend
        run: |
          npm ci
          npm test
          npm run build

  backend-test:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - working-directory: backend
        run: |
          go test ./...
          go build -o bin/app

  e2e:
    needs: [frontend-test, backend-test]
    if: always() && (needs.frontend-test.result == 'success' || needs.backend-test.result == 'success')
    runs-on: ubuntu-latest
    steps:
      - run: echo "Running E2E tests..."
```

## 性能优化

### 并行与依赖优化

```yaml
# 让独立的 job 并行运行
jobs:
  lint:    # 并行
    runs-on: ubuntu-latest
    steps: [...]

  typecheck:  # 并行
    runs-on: ubuntu-latest
    steps: [...]

  test:    # 并行
    runs-on: ubuntu-latest
    steps: [...]

  build:   # 等待以上全部完成
    needs: [lint, typecheck, test]
    runs-on: ubuntu-latest
    steps: [...]
```

### 减少工作流触发频率

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - '.gitignore'
  pull_request:
    types: [opened, synchronize]  # 不需要 closed
    paths-ignore:
      - '**.md'
```

### 使用 Concurrency 避免重复运行

```yaml
# 同一 PR 的新 push 自动取消旧的运行
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ...
```

### 优化 Docker 构建

```dockerfile
# 多阶段构建，减小镜像大小
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
# 只复制必要文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 非根用户运行
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## 常见陷阱

### 1. 分支保护与 workflow_dispatch

```yaml
# workflow_dispatch 触发的工作流默认不受分支保护规则约束
# 需要在 Environment 中配置 required reviewers

on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
```

### 2. GitHub Token 权限不足

```yaml
# GITHUB_TOKEN 默认权限可能不够
# 错误：failed to push some references
# 修复：在 job 中声明权限
permissions:
  contents: write  # 允许推送
  pull-requests: write  # 允许评论 PR
```

### 3. 缓存未命中但认为命中

```yaml
# 错误：假设缓存一定存在
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: pip-${{ hashFiles('requirements.txt') }}
- run: pip install -r requirements.txt  # 缓存未命中时会慢

# 正确：检查缓存是否命中
- uses: actions/cache@v4
  id: cache-pip
  with:
    path: ~/.cache/pip
    key: pip-${{ hashFiles('requirements.txt') }}
- run: pip install -r requirements.txt
  if: steps.cache-pip.outputs.cache-hit != 'true'  # 仅在未命中时安装
```

## 总结

构建高效的 GitHub Actions 流水线需要掌握以下核心能力：

| 能力 | 关键技术 | 收益 |
|------|---------|------|
| 多环境验证 | 矩阵构建 | 一次提交验证所有目标环境 |
| 逻辑复用 | 可复用工作流 | 减少 80% 的重复配置 |
| 加速执行 | 缓存策略 | CI 时间减少 50-70% |
| 安全性 | OIDC + 最小权限 | 消除长期密钥风险 |
| Monorepo | 变更检测 + 条件执行 | 只构建变更的部分 |
| 效率 | Concurrency + 并行 | 避免资源浪费 |

核心原则：**安全第一，速度第二，可维护性第三**。一个不安全的 CI/CD 流水线比没有 CI/CD 更危险。
{% endraw %}
