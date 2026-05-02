---
layout: page
title: "GitHub Actions Workflows"
category: devops-github-actions
sidebar: true
lang: en
lang_alt: /devops-github-actions/
permalink: /en/devops-github-actions/
sort_order: 8
nav:
  prev: /en/devops-k8s-troubleshoot/
  next: /en/devops-gitops/
---

## GitHub Actions Overview

GitHub Actions is GitHub's built-in CI/CD platform. It defines workflows through YAML files that automatically execute builds, tests, and deployments when triggered by code pushes, PR creation, and other events. It integrates deeply with GitHub repositories and works out of the box without additional configuration.

```mermaid
graph LR
    Event[Trigger Event<br/>push/PR/schedule] --> WF[Workflow]
    WF --> J1[Job 1: Build]
    WF --> J2[Job 2: Test]
    WF --> J3[Job 3: Deploy]
    J1 -->|Dependency| J2
    J2 -->|Dependency| J3
    J1 --> S1[Step: Checkout Code]
    J1 --> S2[Step: Install Dependencies]
    J1 --> S3[Step: Compile Build]
```

## Workflow Syntax

### Basic Structure

{% raw %}
```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Concurrency control: only keep the latest run for the same PR
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.value }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for version generation

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm test

      - name: Build application
        run: npm run build

      - name: Generate version
        id: version
        run: echo "value=v$(date +%Y%m%d)-$(git rev-parse --short HEAD)" >> $GITHUB_OUTPUT

  test-e2e:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/

  deploy:
    needs: [build, test-e2e]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: echo "Deploying ${{ needs.build.outputs.version }}"
```
{% endraw %}

### Trigger Conditions

```yaml
on:
  push:
    branches: [main]
    tags: ['v*']           # Tag trigger
    paths:                 # Path filter
      - 'src/**'
      - 'package.json'
  pull_request:
    types: [opened, synchronize]
  schedule:
    - cron: '0 2 * * *'   # Daily at 2 AM
  workflow_dispatch:       # Manual trigger
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'staging'
```

## Common Actions

### Official Recommended Actions

| Action | Purpose |
|--------|---------|
| `actions/checkout@v4` | Checkout repository code |
| `actions/setup-node@v4` | Install Node.js |
| `actions/setup-python@v5` | Install Python |
| `actions/setup-go@v5` | Install Go |
| `actions/cache@v4` | Cache dependencies |
| `actions/upload-artifact@v4` | Upload build artifacts |
| `actions/download-artifact@v4` | Download build artifacts |

### Caching Strategy

{% raw %}
```yaml
- name: Cache dependencies
  uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
```
{% endraw %}

## Environments and Secrets

### Secrets Management

{% raw %}
```yaml
# Configure in repository Settings > Secrets
steps:
  - name: Login to container registry
    uses: docker/login-action@v3
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}  # Automatically provided token

  - name: Use custom secret
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      API_KEY: ${{ secrets.API_KEY }}
    run: npm run migrate
```
{% endraw %}

### Environment Protection Rules

```yaml
deploy:
  runs-on: ubuntu-latest
  environment:
    name: production
    url: https://app.example.com
  # Reviewers need to be configured in repository Settings > Environments
```

## Container Build and Push

### Build and Push Docker Image

{% raw %}
```yaml
docker-build:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4

    - name: Login to GHCR
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Setup Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v5
      with:
        images: ghcr.io/${{ github.repository }}
        tags: |
          type=ref,event=branch
          type=semver,pattern={{version}}
          type=sha,prefix=

    - name: Build and push
      uses: docker/build-push-action@v5
      with:
        context: .
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
```
{% endraw %}

## Advanced Patterns

### Reusable Workflows

Extract common processes into reusable workflows:

{% raw %}
```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
    secrets:
      deploy-key:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - name: Deploy
        run: |
          echo "Deploying ${{ inputs.image-tag }} to ${{ inputs.environment }}"
          # Actual deployment logic
```
{% endraw %}

{% raw %}
```yaml
# Call reusable workflow
jobs:
  deploy-staging:
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: staging
      image-tag: ${{ needs.build.outputs.version }}
    secrets:
      deploy-key: ${{ secrets.STAGING_DEPLOY_KEY }}
```
{% endraw %}

### Matrix Strategy

Test multiple version combinations in parallel:

{% raw %}
```yaml
test:
  runs-on: ${{ matrix.os }}
  strategy:
    fail-fast: false  # One failure doesn't cancel others
    matrix:
      os: [ubuntu-latest, macos-latest]
      node-version: [18, 20, 22]
      exclude:
        - os: macos-latest
          node-version: 18  # Exclude specific combination

  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
    - run: npm ci
    - run: npm test
```
{% endraw %}

```mermaid
graph TB
    subgraph Matrix Execution
        M1["Ubuntu + Node 18"]
        M2["Ubuntu + Node 20"]
        M3["Ubuntu + Node 22"]
        M4["macOS + Node 20"]
        M5["macOS + Node 22"]
    end
    All[Matrix Strategy] --> M1
    All --> M2
    All --> M3
    All --> M4
    All --> M5
```

### Workflow Execution Flow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GH as GitHub
    participant Runner as Runner
    participant Reg as Registry

    Dev->>GH: git push
    GH->>GH: Match trigger conditions
    GH->>Runner: Assign Job
    Runner->>Runner: Checkout code
    Runner->>Runner: Install dependencies
    Runner->>Runner: Run tests
    Runner->>Runner: Build image
    Runner->>Reg: Push image
    Runner->>GH: Report results
    GH->>Dev: Notify status
```

GitHub Actions embeds CI/CD directly into the development workflow, achieving fully automated software delivery from code push to production deployment. Mastering workflow syntax, caching strategies, and advanced patterns significantly improves build efficiency and deployment reliability.
