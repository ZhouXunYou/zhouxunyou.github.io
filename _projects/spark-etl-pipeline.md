---
layout: repo
title: "spark-etl-pipeline"
description: "Apache Spark ETL pipeline framework with structured streaming"
language: "Scala"
language_color: "#c22d40"
stars: 17
forks: 5
category: spark
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
  - name: "conf/"
    type: dir
  - name: "LICENSE"
    type: file
---

# spark-etl-pipeline

Apache Spark ETL pipeline framework with structured streaming support and configurable transforms.

## Features

- Declarative pipeline configuration via HOCON
- Built-in transforms: filter, map, aggregate, join
- Structured Streaming with checkpointing
- Delta Lake integration
- S3/HDFS data source support

## Pipeline Definition

```hocon
pipeline {
  name = "user-events-etl"

  source {
    format = "json"
    path = "s3a://data-lake/raw/events/"
    schema = "userId STRING, event STRING, timestamp LONG"
  }

  transforms = [
    { type = "filter", condition = "event IS NOT NULL" },
    { type = "map", column = "date", expr = "to_date(from_unixtime(timestamp))" },
    { type = "aggregate", groupBy = ["date", "event"], agg = "count(*) AS cnt" }
  ]

  sink {
    format = "delta"
    path = "s3a://data-lake/curated/user-events/"
    mode = "append"
  }
}
```

## License

Apache-2.0
