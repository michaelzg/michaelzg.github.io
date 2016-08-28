---
layout: post
title:  "Scheduled R Code"
date:   2015-07-10 11:01:00
categories: R
---

Running R scripts as a cron job is useful for executing jobs on a schedule. 

This script would do three things:

**1:** Download the data with `download.file()`
    
**2:** Do some initial processing (e.g. unzip with `untar`, filter out things you don't need, add a new column for something you know you will need, etc) 

 For example, every entry in the data had a timestamp but it was in Unix epoch time. To convert it, I learned this nice `as.POSIXct` function:
 

Time was given in milleseconds, thats 13 digits. The function wants it in seconds:

{% highlight R %}

    time <- 1390409880221
    as.POSIXct(time/1e3, origin = "1970-01-01")
    # "2014-01-22 11:58:00 EST"
    
{% endhighlight %}     

There is another, similar function, `as.POSIXlt` but from [what I've read](http://stackoverflow.com/questions/10699511/difference-between-as-posixct-as-posixlt-and-strptime-for-converting-character-v) that just converts the time into a format that stores it differently (seconds for the first and day-month-year etc for the second). 

**3:** Dump the data in a folder. But rather than a folder, this may be a great place for a database. Just haven't learned it *yet*.

Done? Not so fast! What if there is an error in the first step of downloading the file? What if the data returns empty due to something on the website's side of things? We'd want to handle these errors and let the script tell us something helpful when they occur. For this, I used `tryCatch` and here's a [wonderful blog post by Jonathan Callahan on exactly how to use it.](http://mazamascience.com/WorkingWithData/?p=912)


But this script runs every hour and it can fail one hour and be successful another. So how do we log those potentially varying status reports? Remember, writing to some command line or console won't work because there is no permanently active session open to write to. Plus even if there was, what if it closes? You'd still want to know the status...

So, to help with that I personally just updated logs in a text file like with `readLines` and `writeLines` like so:

{% highlight R %}

	timeStamp <- Sys.time()
    log <- readLines("log.txt")
    log <- append(log, c(timeStamp,"new status"))
    writeLines(log, "log.txt")
    
{% endhighlight %}
    
Great--the script can now handle errors and record them convieniently in a text file. 

But hey! We can make the script even smarter. Chances are these scheduled scripts run on some server that stays on and you `ssh` into them every time you want to do some stuff. How inconvient! How about we set another script to automate sending the log.txt file right to your inbox in the form of an email.

`sendmailR` package can help you do that. It's straightforward so I'll leave you to the [documentation](http://cran.r-project.org/web/packages/sendmailR/sendmailR.pdf) and [this helpful SO answer on attachments.](http://stackoverflow.com/questions/2885660/how-to-send-email-with-attachment-from-r-in-windows). Note there's another package in R for sending mail, that is called the `mail` package but I *think* it sends it some alternate way where it passes through another server. Eh. But don't quote me on that though..

Okay last but certainly not the hardest is the scheduled task with cron. We'll use Rscript because [this SO answer said so](http://stackoverflow.com/questions/10116411/schedule-r-script-using-cron), but honestly use it because it just works.

Set up a cron job under a specified user (not root) by doing `crontab -u user -e` and a little cron document shows up for you to edit.

At the end of the file you can enter something like:

    0 * * * * Rscript /some/path/to/yourScript.r

to run `yourScript.r` at the top of the hour, every day of every week. More options for each asterisk:

1. The number of minutes after the hour (0 to 59)
2. The hour in military time (24 hour) format (0 to 23)
3. The day of the month (1 to 31)
4. The month (1 to 12)
5. The day of the week (0 or 7 is Sun, or use name)

[wiki on cron](http://en.wikipedia.org/wiki/Cron)
