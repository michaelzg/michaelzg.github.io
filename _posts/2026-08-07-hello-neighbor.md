---
layout: post
title: "Hello, Neighbor"
date: 2026-08-07
published: true
description: "What actually happens when two computers on the same Wi-Fi network establish a TCP connection."
body_class: page-hello-neighbor
extra_styles:
  - /css/hello-neighbor.css
extra_scripts:
  - /assets/js/hello-neighbor.js
---

One computer says "hello" to another. How does it do that?
![A Mac mini saying hello to a MacBook](/assets/img/hello-neighbor.png)

The "hello" is sent through a TCP connection using netcat:

{% include hello-neighbor-terminal.html %}

What just happened?