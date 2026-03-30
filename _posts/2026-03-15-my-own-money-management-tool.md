---
layout: post
title: "Replacing a $108/yr Money Management Tool With My Own"
date: 2026-03-16
published: true
---

I was paying $108/yr for an expense tracking/budgeting tool tied to my credit cards. 
I realized I can just build it myself now. 
So I spent the past two weekends on that with Opus 4.6 and GPT 5.4. 
And now it costs me $15/yr. It's more useful to me too. 
And I learned some things throughout the process. 

Here is what my expenses dashboard looks like (faked numbers).

{% include theme_image.html light="/assets/img/fin1-expenses-light.png" dark="/assets/img/fin1-expenses-dark.png" alt="Full expenses dashboard" loading="eager" %}

A big sell from my original money management tool was helping you budget.
But I found that I didn't use the budgeting part much anyway. 
And the UI made it feel complicated and tedious. 
The nice part of building it myself is I can cut out what I do not need and extend what I do. 
For now that means a clean overview, a couple graphs, and an expense ledger with all the filtering I ever wanted. 
I'm sure I'll add back a budgeting tab for specific goals and projects soon.

The overview gives me the quick read: spending, budget left, month-over-month trend, 
and what still needs categorizing. The graphs are there to help me scan the timeline and category mix. 

{% include theme_image.html light="/assets/img/fin1-graphs-light.gif" dark="/assets/img/fin1-graphs-dark.gif" alt="Overview and graphs" %}

And then there is the ledger, which is probably the part I use most. 
That is where I finally got all the filtering and tinkering I need: 
by credit card, category, description, custom date range, last 6-months, 
sort by amount, and inline re-categorizing when I notice something is off.

{% include theme_image.html light="/assets/img/fin1-filter-light.gif" dark="/assets/img/fin1-filter-dark.gif" alt="Expense ledger with filters" %}

Since then it has been a nice late-night project after the family is asleep.
Add a feature. Fix a bug. Refine and tighten the UI. Repeat. It was fun!
I also ended up building things I was not even originally aiming for, 
like the auto-classification of transactions to categories.
Though, I'd like to refine it more before sharing more about it. 
I got to try [Dolt](https://www.dolthub.com/) too for the storage backend. 
And learned more about the different ways of connecting and pulling data from your banks:
[SimpleFIN](https://www.simplefin.org/) vs. [Plaid](https://plaid.com/). 
Two weekends was enough to give me confidence to cancel the subscription.

Not all roses, of course. At one point imports quietly stopped for five days. 
I looked into it and decided a quick and simple thing to try was re-linking my bank integrations. 
That worked, however the next import replayed transactions and gave me duplicates. 
So I had to extend my deduping logic to handle this edge case. 
Still, GPT 5.4 worked through it.

The bigger takeaway is feeling how much more practical it is to build 
small software tools that are tailored exactly to what I want. 

I'll do a followup post on how I extend this to financial modeling and planning towards retirement.

* * * 

Some developer notes below.

On models: I did find Opus 4.6 to have better UI taste than GPT 5.4. 
Example was making the multi-layered bar chart: I was 5-iterations deep with GPT 5.4 
and it still didn't look nearly the way I wanted it to with glaring spacing and 
proportion issues. When my usage quota for Claude reset, Opus 4.6 was able to 
one-shot it to something 90% of the way I wanted it to look.

On architecture:
- Transaction store: [Dolt](https://www.dolthub.com/) (marketed as git for data) gives an auditable log without the overhead of one. Has a SQL interface.
- API: Rust/Axum layer on top of the store for all reads/writes. Caching on categories, overview, and analytics.
- UI: React frontend. [Recharts](https://recharts.github.io/) for graphs.
- Syncing transactions with the banks: Python daily cron job via [SimpleFIN](https://www.simplefin.org/) for polling, deduplication, and batched categorization.
- Importing history: CSV ingest that hits the same write APIs as above.
