---
layout: post
title:  "Using Akka HTTP Server Part 1: Soda Vending Machine Demo"
date:   2016-10-30 00:00:00
categories: akka
published: false
---
This blog post will demonstrate a simple HTTP API implementation of a soda vending machine. I'll highlight the handy use of unmarshallers and the use of an actor to encapsulate state.

We'll create a Soda Vending Machine HTTP API with the following functions:

|Method|Route & Query|Functionality|Example|
|---|---|---|---|
|GET|`/check`|Gheck soda available|   |
|GET|`/history?startDate=<string>&endDate=<string>`|unrealistic function to return all transactions from the machine| |
|POST|`/buy`|buy soda. If there isn't enough money in the first POST, store the state so the user can keep feeding money!|   |
|DELETE|`/dispense?id=<int>`|Dispense all the change and cancel the transaction|   |

### Layout

I could describe how the packages and classes all work together, but let me know _show_ you first.

_diagram_

### Handling and Parsing Requests

We want our route definitions clean. Let Akka http unmarshallers help you do that.

### Encapsulating State Through an Actor

### Delivering Responses

Testing will be a topic for Part 2
