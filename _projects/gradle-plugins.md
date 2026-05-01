---
layout: repo
title: "gradle-plugins"
description: "Custom Gradle plugins for JVM project automation"
language: "Groovy"
language_color: "#4298b8"
stars: 11
forks: 3
category: gradle
pinned: false
license: "MIT"
files:
  - name: "plugins/"
    type: dir
  - name: "plugins/docker-build/"
    type: dir
  - name: "plugins/versioning/"
    type: dir
  - name: "README.md"
    type: file
  - name: "build.gradle"
    type: file
  - name: "settings.gradle"
    type: file
  - name: "LICENSE"
    type: file
---

# gradle-plugins

Custom Gradle plugins for JVM project automation, including Docker build, semantic versioning, and release management.

## Plugins

### docker-build

Automates Docker image building and pushing from Gradle.

```groovy
plugins {
    id 'com.github.zhouxunyou.docker-build'
}

dockerBuild {
    imageName = 'my-app'
    tags = ['latest', version]
    registry = 'ghcr.io'
    dockerfile = file('Dockerfile')
}
```

### versioning

Semantic versioning based on Git tags and conventional commits.

```groovy
plugins {
    id 'com.github.zhouxunyou.versioning'
}

// Automatically sets project.version from git tags
// e.g., tag v1.2.3 -> version 1.2.3
// uncommitted changes -> version 1.2.4-SNAPSHOT
```

## License

MIT
