---
title: 广告门测试
subtitle: Link Gate Test
category: frontend
layout: page
permalink: /link-gate-test/
link_gate_slug: test-resource
lang: zh
order: 999
---

## 广告门功能测试

这是一个测试页面，用于验证"观看广告后获取下载链接"功能。

### 功能说明

1. 页面加载后展示广告
2. 广告加载后启动 10 秒倒计时
3. 倒计时结束后"获取下载链接"按钮激活
4. 点击按钮调用后端 API 获取百度网盘链接

### 测试步骤

1. 等待广告加载
2. 等待 10 秒倒计时结束
3. 点击"获取下载链接"按钮
4. 查看是否返回链接和提取码
