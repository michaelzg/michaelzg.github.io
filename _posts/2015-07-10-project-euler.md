---
layout: post
title:  "Project Euler"
date:   2015-07-10 11:02:00
categories: euler
---

[Project Euler](https://projecteuler.net/) is a bunch of fun math problems that you solve through computer. As of March 2nd 2014 there are 461 problems. I'm taking a crack at them (with R) for practice so here are the first few.

---


### Problem #1: Multiples of 3 and 5
*Find the sum of all the multiples of 3 or 5 below 1000.*

Get multiples of 3 and 5, stick em in vector. Then, you don't want duplicates of both, e.g. 30 is both multiple of 3 and 5 and thus listed twice. So sum the unique values.

{% highlight R %}

mults <- c(seq(0,1000,3), seq(0,999,5))
sum(unique(mults))
# 233168

{% endhighlight %}	

### Problem #2: Even Fibonacci Numbers
*By considering the terms in the Fibonacci sequence whose values do not exceed four million, find the sum of the even-valued terms.*

First create a string of Fib numbers up to that 4e6 value. Then grab the evens and add'em up.

{% highlight R %}

F <- c(1,1)
while( sum(tail(F,2)) < 4000000 ){
	F <- append( F, sum(tail(F, 2)) )
}
#sum evens
sum(F[F %% 2 == 0])
# 4613732
	
{% endhighlight %}	

### Problem #3: Largest Prime Factor
*What is the largest prime factor of the number 600851475143 ?*

We first want a way to check if a number is prime. I implemented a `isPrime` function, below:

{% highlight R %}

isPrime <- function(n){
	rootn  <- as.integer(sqrt(n))  
	vector <- seq(2,rootn)
	
	set <- n %% vector
    
	if (length(which( set == 0 )) > 0){
		return("Nope not prime.")
	} else if (length(which( set != 0 ))) > 0{
		return("Prime!!")
	}
}
	
{% endhighlight %}
    
with that out of the way, we dive in. Set 600851475143 as `num`. We make a sequence of candidate factors, noting that we only need to test up to the square root of the number as testing one factor rules out 2 numbers. 

{% highlight R %}

seq_num <- seq(2, sqrt(num))
# Factors are those that divide `num` with a modulus of 0 
factors <- seq_num[num % seq.num == 0]
# test factors for prime
unlist(lapply(factors, function(x) isPrime(x)))
    
{% endhighlight %}
    
And the largest is six thousand eight hundred and fifty seven!