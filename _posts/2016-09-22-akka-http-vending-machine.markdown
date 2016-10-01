---
layout: post
title:  "Using Akka HTTP Server: Soda Vending Machine Demo"
date:   2016-09-22 00:00:00
categories: akka
published: false
---
It's been over a year since my last blog post and _a_ _lot_ has happened since then. I'm back! And I'll be writing about the things I've had the pleasure of working with recently: the Scala language and the Akka framework. 
This blog post will demonstrate a simple HTTP API implementation of a soda vending machine. I'll highlight the handy use of unmarshallers and the use of an actor to encapsulate state.


the buy route and the fields accepted:

/buy?soda=<soda>&money=1,2,3

