---
layout: post
title: "Advanced GitHub Actions: Building Efficient CI/CD Pipelines"
date: 2025-04-01
categories: [devops]
author: Zhou Xunyou
lang: en
---

{% raw %}
GitHub Actions is one of the most popular CI/CD platforms today, yet many teams only use its most basic features — running tests and building images. This article explores advanced GitHub Actions capabilities including matrix builds, reusable workflows, caching strategies, security best practices, and performance optimization to help you build truly efficient CI/CD pipelines.

## Matrix Builds: Configure Once, Verify Everywhere

Matrix strategies let you run tests across multiple environments with a single workflow definition.

### Basic Matrix

```yaml
name: Matrix Build

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false  # One failure doesn't affect others
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20, 22]
        exclude:
          - os: macos-latest
            node-version: 18  # Don't test Node 18 on macOS
        include:
          - os: ubuntu-latest
            node-version: 22
            experimental: true  # Extra variable
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

### Dynamic Matrix: Build Only What Changed

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

## Reusable Workflows

Extract common logic into reusable workflows to avoid duplicating definitions across repositories.

### Defining a Reusable Workflow

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
          # Deployment logic...

      - name: Notify
        if: always()
        run: |
          echo "Deployment ${{ job.status }} for ${{ inputs.environment }}"
```

### Calling a Reusable Workflow

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

### Cross-Repository Reuse

```yaml
# Call from another repository
jobs:
  deploy:
    uses: my-org/shared-workflows/.github/workflows/deploy.yml@v1
    with:
      environment: production
    secrets: inherit
```

## Caching Strategies

Caching is the most effective way to speed up CI, but misapplied caching is worse than no caching at all.

### Dependency Caching

```yaml
# Node.js caching
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: 'npm'  # Auto-cache node_modules

# Go caching
- uses: actions/setup-go@v5
  with:
    go-version: '1.22'
    cache: true

# Manual caching (more flexible)
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

### Docker Layer Caching

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

      # Swap cache directories to prevent unbounded growth
      - name: Move cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache
```

### Caching Best Practices

```yaml
# 1. Use hashFiles as cache key — auto-invalidates on dependency changes
key: deps-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

# 2. Set restore-keys as fallback — partial hit is better than none
restore-keys: |
  deps-${{ runner.os }}-

# 3. Mind the cache size limit (10GB/repository)
# Oversized caches slow down restoration

# 4. Multi-path caching
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      ~/.cache/node
      node_modules
    key: npm-${{ hashFiles('package-lock.json') }}
```

## Custom Actions

### Composite Action: Combine Multiple Steps

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

# Usage
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-project
        with:
          node-version: '20'
```

### JavaScript Action: More Flexible Logic

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

## Security Best Practices

### OIDC Authentication: Say Goodbye to Long-lived Keys

```yaml
# No need to store long-lived keys like AWS_ACCESS_KEY_ID
# Use OIDC to obtain temporary credentials

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # Required!
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeploy
          aws-region: ap-southeast-1
          # No access-key-id or secret-access-key needed!

      - name: Deploy to EKS
        run: |
          kubectl apply -f k8s/
```

### Secrets Management

```yaml
# 1. Use GitHub Secrets for sensitive data
# Settings → Secrets and variables → Actions

# 2. Use Environment Secrets (require approval)
# Ideal for production deployments

jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment:
      name: production
      # Requires approver confirmation
      # protection_rules:
      #   required_reviewers: ['team-lead']
    steps:
      - run: echo "Deploying with ${{ secrets.DEPLOY_KEY }}"

# 3. Avoid leaking Secrets in logs
- name: Safe output
  run: |
    # Wrong: echo "${{ secrets.MY_SECRET }}"  # May appear in logs
    # Correct: use environment variables
    echo "::add-mask::$MY_SECRET"
    # GitHub automatically masks known secret values
  env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
```

### Principle of Least Privilege

```yaml
# Set minimum permissions for each job
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read       # Read-only code
      packages: write      # Write packages

  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write      # OIDC

# Global default minimum permissions (recommended)
permissions:
  contents: read
```

## Monorepo Patterns

### Change Detection + Conditional Execution

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

## Performance Optimization

### Parallelization and Dependency Optimization

```yaml
# Let independent jobs run in parallel
jobs:
  lint:    # Parallel
    runs-on: ubuntu-latest
    steps: [...]

  typecheck:  # Parallel
    runs-on: ubuntu-latest
    steps: [...]

  test:    # Parallel
    runs-on: ubuntu-latest
    steps: [...]

  build:   # Waits for all above
    needs: [lint, typecheck, test]
    runs-on: ubuntu-latest
    steps: [...]
```

### Reduce Workflow Trigger Frequency

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - '.gitignore'
  pull_request:
    types: [opened, synchronize]  # Don't need closed
    paths-ignore:
      - '**.md'
```

### Use Concurrency to Avoid Duplicate Runs

```yaml
# New push to same PR auto-cancels old runs
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ...
```

### Optimized Docker Build

```dockerfile
# Multi-stage build for smaller images
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
# Copy only necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Run as non-root user
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## Common Pitfalls

### 1. Branch Protection and workflow_dispatch

```yaml
# Workflows triggered by workflow_dispatch bypass branch protection by default
# Configure required reviewers in Environments instead

on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
```

### 2. Insufficient GitHub Token Permissions

```yaml
# GITHUB_TOKEN default permissions may be insufficient
# Error: failed to push some references
# Fix: declare permissions in the job
permissions:
  contents: write  # Allow pushes
  pull-requests: write  # Allow PR comments
```

### 3. Assuming Cache Hit When It Missed

```yaml
# Wrong: assuming cache always exists
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: pip-${{ hashFiles('requirements.txt') }}
- run: pip install -r requirements.txt  # Slow on cache miss

# Correct: check if cache was hit
- uses: actions/cache@v4
  id: cache-pip
  with:
    path: ~/.cache/pip
    key: pip-${{ hashFiles('requirements.txt') }}
- run: pip install -r requirements.txt
  if: steps.cache-pip.outputs.cache-hit != 'true'  # Only install on miss
```

## Conclusion

Building efficient GitHub Actions pipelines requires mastering these core capabilities:

| Capability | Key Technique | Benefit |
|-----------|---------------|---------|
| Multi-environment testing | Matrix builds | Verify all targets per commit |
| Logic reuse | Reusable workflows | Eliminate 80% duplicate config |
| Faster execution | Caching strategies | Reduce CI time by 50-70% |
| Security | OIDC + least privilege | Eliminate long-lived key risks |
| Monorepo | Change detection + conditional | Build only what changed |
| Efficiency | Concurrency + parallelism | Avoid wasted resources |

Core principle: **security first, speed second, maintainability third**. An insecure CI/CD pipeline is more dangerous than no CI/CD at all.
{% endraw %}
