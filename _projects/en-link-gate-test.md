---
title: Link Gate Test
subtitle: Ad Gate Testing
category: frontend
layout: page
permalink: /en-link-gate-test/
link_gate_slug: test-resource
lang: en
order: 999
---

## Link Gate Feature Test

This is a test page for the "watch ad to get download link" feature.

### How It Works

1. Ad is displayed on page load
2. A 10-second countdown starts after ad loads
3. The "Get Download Link" button activates when countdown ends
4. Click the button to call the backend API and get a Baidu Pan link

### Test Steps

1. Wait for the ad to load
2. Wait for the 10-second countdown to finish
3. Click the "Get Download Link" button
4. Check if a link and password are returned
