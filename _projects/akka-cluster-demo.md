---
layout: repo
title: "akka-cluster-demo"
description: "Akka Cluster demonstration with distributed worker pattern"
language: "Scala"
language_color: "#c22d40"
stars: 9
forks: 2
category: akka
pinned: false
license: "Apache-2.0"
files:
  - name: "src/"
    type: dir
  - name: "src/main/scala/"
    type: dir
  - name: "src/main/resources/"
    type: dir
  - name: "README.md"
    type: file
  - name: "build.sbt"
    type: file
  - name: "docker-compose.yml"
    type: file
  - name: "LICENSE"
    type: file
---

# akka-cluster-demo

Akka Cluster demonstration project implementing the distributed worker pattern with Cluster Sharding.

## Architecture

```
┌─────────┐    ┌─────────┐    ┌─────────┐
│  Node 1 │    │  Node 2 │    │  Node 3 │
│ Master  │◄──►│ Worker  │◄──►│ Worker  │
│ +Worker │    │         │    │         │
└─────────┘    └─────────┘    └─────────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
            ┌───────┴───────┐
            │  Seed Nodes   │
            └───────────────┘
```

## Quick Start

```bash
# Start seed nodes
sbt "runMain com.example.ClusterSeed 2551"
sbt "runMain com.example.ClusterSeed 2552"

# Start worker nodes
sbt "runMain com.example.WorkerNode 0"
```

## Key Components

- **Cluster Singleton**: Master actor coordinates work distribution
- **Cluster Sharding**: Stateful entities distributed across nodes
- **Distributed Data**: CRDTs for cluster-wide state
- **Cluster Subscription**: React to cluster membership changes

## License

Apache-2.0
