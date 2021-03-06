---
layout: post
title:  "Unified Historical and New Data Streams: Move the Polling to the Backend"
date:   2019-12-14 00:00:00
categories: akka
published: true
---

Imagine the implementation of a continually updating time-series graph or a newsfeed.
It can be thought of as two data streams:
a finite stream populating historical data and an infinite stream providing the new data.
Traditionally, API clients (e.g. a UI) may be pulling this off by
continually polling the backend API endpoint at some interval or
juggling two separate endpoints for both streams. This post showcases moving that client logic into the backend API and
exposing a unified interface for handling both types of data streams.

Benefits include:

* A simpler query pattern for clients.
* More control over the polling interval, which can tuned for the tradeoff between responsiveness and backend load.
* Flexibility in iterating the implementation. A client does not need to change the way it queries if the backend integrated with single database or a database and an event log.

I'll first go over implementation and tests–using Scala & Akka Streams–and conclude
with implications for gRPC and considerations for real-time streaming.
I assume the reader has background knowledge about
[Akka Streams](https://doc.akka.io/docs/akka/current/stream/index.html).

To just see working code, [here is the repository on my Github](https://github.com/michaelzg/blog-scala/blob/master/streaming-merge).
It's using Scala `2.13.x` and Akka `2.6.x`. I'll try to keep it up-to-date and relevant through time.
I also link to the specific sections of source code as I walk through it.

## Interface & Implementation

The toy context is a Twitter feed for some specified `user`.

```scala
trait TweetStream {
  def stream(user: String, start: DateTime, end: Option[DateTime]): Source[Tweet, NotUsed]
}
```
[GitHub Source](https://github.com/michaelzg/blog-scala/blob/master/streaming-merge/src/TweetStream.scala)

One can query historical-only data (finite) or a
combined historical and new data stream (infinite) depending on
whether the `end` timestamp is supplied.
Here is the first layer of implementation handling this logic.

```scala
def stream(user: String, start: DateTime, end: Option[DateTime]): Source[Tweet, NotUsed] = {
  end match {
    case None =>
      // infinite
      val oldTweets = historical(user, start, utcTimeNow())
      val incomingNewTweets = periodicPoll(user)
      Source.combine(oldTweets, incomingNewTweets)(Concat(_))

    case Some(e) =>
      // finite
      historical(user, start, e)
  }
}
```
[GitHub Source](https://github.com/michaelzg/blog-scala/blob/master/streaming-merge/src/TweetStreamImpl.scala)

Both `historical` and `periodicPoll` are functions returning `Source[Tweet, NotUsed]`.
The key here is the concatentation of two data streams using
Akka's [Source.combine](https://doc.akka.io/docs/akka/current/stream/operators/Source/combine.html) with `Concat` strategy.
The strategy first emits all `Tweets` from the historical data source and then
emits the new `Tweets` through a periodic polling source.

The `historical` function is straight forward. What is more interesting
is the periodic polling implemented as a stream:

```scala
def periodicPoll(user: String): Source[Tweet, NotUsed] = {
  Source
    .tick(initialDelay = pollInterval, interval = pollInterval, Unit)
    .statefulMapConcat { () =>
      var bookmark = utcTimeNow()
      _ =>
        {
          val newBookend = utcTimeNow()
          val (start, end) = (bookmark, newBookend)
          bookmark = newBookend
          List(start -> end)
        }
    }
    .mapAsync(parallelism = 1) {
      case (start, end) => query(user, start, end)
    }
    .mapConcat(identity)
    .mapMaterializedValue(_ => NotUsed)
}
```
[GitHub Source](https://github.com/michaelzg/blog-scala/blob/master/streaming-merge/src/TweetStreamImpl.scala)


Let's break it down:

* [Source.tick](https://doc.akka.io/docs/akka/current/stream/operators/Source/tick.html#source-tick) provides the periodic trigger for the downstream operations. This is done at a defined interval. Picked carefully. One too short can overload the backend store. One too long increases latency of new data reaching the client.
* [statefulMapConcat](https://doc.akka.io/docs/akka/current/stream/operators/Source-or-Flow/statefulMapConcat.html) allows us to maintain the `bookmark` state which represents the ending timestamp of the last query. We update this bookmark with every new poll to avoid returning duplicate elements and keeping the queried time windows short and sequentially accurate.
* The rest is textbook: the `mapAsync` executes the `Future` query to return `List[Tweets]` downstream. `mapConcat` unwraps the list into individual `Tweet`s. `mapMaterializedValue` maintains the interface and has some implications if one were using this Source to implement a gRPC interface (more later).

This, combined with `historical`, results a unified
interface allowing for flexible query patterns. 

## Unit Testing and See it in Action

Unit tests can be done with a mocked storage layer.
The `StubAutoRefreshingTweetStore` below first initializes some `users` with backfilled data and appends one new `Tweet` every second. Think of this as emulating a database.

```scala
class StubAutoRefreshingTweetStore(users: List[String], referenceTime: DateTime, scheduler: Scheduler)(
    implicit ec: ExecutionContext)
    extends TweetStore {

  private val oneSecond = Duration(1, TimeUnit.SECONDS)
  
  private var data: Map[String, List[Tweet]] =
    users.map(user => user -> initializeTweets(user)).toMap

  scheduler.scheduleAtFixedRate(initialDelay = oneSecond, interval = oneSecond)(new Runnable() {
    override def run(): Unit = users.foreach(newTweet)
  })

  def query(user: String, start: DateTime, end: DateTime): Future[List[Tweet]] = {
    val interval = new Interval(start, end)
    val result = data
      .get(user)
      .map { tweets =>
        tweets.filter(t => interval.contains(t.timestamp))
      }
      .getOrElse(List.empty)
    Future.successful(result)
  }

  // Details & helper functions snipped
}
```
[GitHub Source](https://github.com/michaelzg/blog-scala/blob/master/streaming-merge/test/src/StubAutoRefreshingTweetStore.scala)

This stub allows us to write a unit test ([Scalatest `FreeSpec`](http://www.scalatest.org/at_a_glance/FreeSpec))
showcasing a combined historical and new data stream.

```scala
"Infinite stream with new tweets" - {
  val tweetStream = {
    val tweetStore = new StubAutoRefreshingTweetStore(users, referenceTime, scheduler)
    TweetStreamImpl(pollInterval = 1.second, store = tweetStore)
  }

  val maxTweets = 10
  s"should return an stream of live tweets as they come in (up to $maxTweets)" in {
    println("Historical + new data stream")
    tweetStream
      .stream("wayne", start = referenceTime.minusDays(2), end = None)
      .take(maxTweets)
      .map(println)
      .runWith(Sink.seq)
      .map(_.size shouldBe maxTweets)
  }
}
```
[GitHub Source](https://github.com/michaelzg/blog-scala/blob/master/streaming-merge/test/src/TweetStreamExample.scala)

See both historical and new data emitted in the same stream print out to the console.
Wayne's day-old tweets print out immediately, and his new "live tweets" print out every second as they get "inserted", up to `maxTweets = 10`, before completing. The stream would keep printing if one removed the `take` stage. Contrast this with Bruce's historical-only stream completing immediately.

```
Historical
2019-12-15T06:31:36.729Z - User bruce tweeted 'Hello World! Tweet number 1' [Likes: 54, Retweets: 49]
2019-12-15T07:31:36.729Z - User bruce tweeted 'Hello World! Tweet number 2' [Likes: 64, Retweets: 41]
2019-12-15T08:31:36.729Z - User bruce tweeted 'Hello World! Tweet number 3' [Likes: 56, Retweets: 20]
2019-12-15T09:31:36.729Z - User bruce tweeted 'Hello World! Tweet number 4' [Likes: 8, Retweets: 40]
2019-12-15T10:31:36.729Z - User bruce tweeted 'Hello World! Tweet number 5' [Likes: 49, Retweets: 8]
Historical + new data stream
2019-12-15T06:31:36.729Z - User wayne tweeted 'Hello World! Tweet number 1' [Likes: 40, Retweets: 0]
2019-12-15T07:31:36.729Z - User wayne tweeted 'Hello World! Tweet number 2' [Likes: 60, Retweets: 42]
2019-12-15T08:31:36.729Z - User wayne tweeted 'Hello World! Tweet number 3' [Likes: 28, Retweets: 35]
2019-12-15T09:31:36.729Z - User wayne tweeted 'Hello World! Tweet number 4' [Likes: 16, Retweets: 36]
2019-12-15T10:31:36.729Z - User wayne tweeted 'Hello World! Tweet number 5' [Likes: 65, Retweets: 48]
2019-12-16T05:31:37.786Z - User wayne tweeted 'I'm frantically live tweeting!' [Likes: 0, Retweets: 0]
2019-12-16T05:31:38.786Z - User wayne tweeted 'I'm frantically live tweeting!' [Likes: 0, Retweets: 4]
2019-12-16T05:31:39.786Z - User wayne tweeted 'I'm frantically live tweeting!' [Likes: 4, Retweets: 4]
2019-12-16T05:31:40.786Z - User wayne tweeted 'I'm frantically live tweeting!' [Likes: 5, Retweets: 4]
2019-12-16T05:31:41.788Z - User wayne tweeted 'I'm frantically live tweeting!' [Likes: 1, Retweets: 4]
[info] TweetStreamExample:
[info] Finite historical stream
[info] - should return 5 historical tweets from the past
[info] Infinite stream with new tweets
[info] - should return an stream of live tweets as they come in (up to 10)
[info] Run completed in 5 seconds, 916 milliseconds.
[info] Total number of tests run: 2
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 2, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

## In Practice

How does this all integrate into an actual API server?

With [gRPC](https://grpc.io), the `TweetStream` interface's return type of `Source[Tweet, NotUsed]` 
plays very well with [server streaming gRPC](https://grpc.io/docs/guides/concepts/) and the streaming 
server interface types with [Akka gRPC](https://doc.akka.io/docs/akka-grpc/current/index.html).
Streamed responses are `Source[T, NotUsed]`.
One can get up and running and implement simple and powerful streaming API this way.

With HTTP APIs, one can integrate `Source`s using Akka HTTP 
[Source Streaming](https://doc.akka.io/docs/akka-http/current/routing-dsl/source-streaming-support.html) and
[Server-sent Events](https://doc.akka.io/docs/akka-http/current/common/sse-support.html).

Note that I took care of not abusing the word "real-time" due to the polling nature.
While it can come close, the responsiveness for delivering new data is limited by the polling interval.
If one were to instead integrate with a Kafka consumer or some other push-model interface,
new data can be ingested and delivered to the client faster. The tradeoff here is the complexity in 
merging two data sources to ensure data integrity: deduplication, sanitization, and potentially parsing different serialization formats.
