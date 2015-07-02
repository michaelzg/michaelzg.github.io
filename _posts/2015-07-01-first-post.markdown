---
layout: post
title:  "First Post"
date:   2015-07-01 23:49:00
categories: hello
---
Wow my first post this is great. Let's test some R Code:

{% highlight R %}
bunches <- rnorm(100)
bunches2 <- lapply(bunches, function(x) x * 2)
hist(unlist(bunches2))
#=> normal, shift to the right
{% endhighlight %}

