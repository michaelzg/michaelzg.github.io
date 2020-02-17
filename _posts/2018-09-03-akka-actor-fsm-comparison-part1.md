---
layout: post
title:  "Comparing Akka Untyped, FSM, and Typed Actors Part 1: Implementation"
date:   2018-09-03 00:00:00
categories: akka
published: true
---

Using [Akka actors](https://doc.akka.io/docs/akka/current/general/actors.html) in Scala, 
I'll be discussing three approaches to implement a finite state machine: 
[Untyped](#untyped-actor), [Untyped FSM](#untyped-fsm-actor), and 
[Typed](#typed-actor). I will provide code to portray their nuances and
highlight some interesting aspects of each. 
Testing is another important consideration that I've saved for Part 2.
If one would rather run the full code and test suite,
I've put [this project on my GitHub](https://github.com/michaelzg/blog-scala/tree/master/cooking-fsm-demo).

I'll be using Akka version `2.6.3` (last updated Feb 2020).
Please note that as of this writing, the Akka Typed module 
[may change](https://doc.akka.io/docs/akka/current/common/may-change.html)
so if they do I'll update accordingly.

Let's dive in. The following diagram represents a simple but demonstrative example: a chef cooking ingredients for customers.

![akka-actor-chef-fsm](/assets/img/akka-actor-chef-fsm.png)

A chef is given `Ingredients` to cook. Cooking can yield `CookedFood`
which will then be plated and served to a limited amount of customers.
However, cooking can also result in `BurntFood`, which means back to
more cooking when more `Ingredients` are received.
When all customers are served, the chef is done.

There will be a manager actor interacting with the chef actor,
periodically querying `AreYouDone` in which the chef will
respond with its state in a `Reply`. 

Below is the protocol used by the untyped chef actors.
The typed protocol will have a slight difference, discussed later.

```scala
sealed trait ChefMsg

case object AreYouDone extends ChefMsg

sealed trait Food extends ChefMsg { def servings: Int }
final case class Ingredients(servings: Int) extends Food
final case class CookedFood(servings: Int) extends Food
final case class BurntFood(servings: Int) extends Food
```

And below is the protocol for the untyped manager actor. The typed protocol will have a slight difference, discussed later.

```scala
sealed trait ManagerMsg

final case class Introduce(chef: ActorRef) extends ManagerMsg

case object Poll extends ManagerMsg
final case class Reply(served: Int, isDone: Boolean) extends ManagerMsg
```

## Untyped Actor

The [untyped actor](https://doc.akka.io/docs/akka/current/actors.html) can leverage `context.become` for state transitions. 
A [commonly advocated pattern](https://github.com/alexandru/scala-best-practices/blob/master/sections/5-actors.md#52-should-mutate-state-in-actors-only-with-contextbecome)
is mutating state data by passing it as a parameter upon `context.become`.
I leave logging for only this implementation to show the interaction between the chef and manager.

```scala
class Chef(customers: Int, skill: CookingSkill)
  extends Actor with ActorLogging {

  def receive: Receive = cooking(Data(served = 0))

  def cooking(data: Data): Receive = {
    case ing @ Ingredients(servings) =>
      log.info("Cooking {} servings.", servings)
      pipe(skill.cook(ing)) to self

    case cooked: CookedFood =>
      self ! cooked
      context.become(plating(data))

    case BurntFood(servings) =>
      log.warning("Burnt {} servings.", servings)

    case AreYouDone =>
      sender() ! Reply(data.served, isDone = false)
  }

  def plating(data: Data): Receive = {
    case CookedFood(servings) =>
      log.info("Plating {} servings.", servings)
      val newData = Data(data.served + servings)
      if (newData.served >= customers) {
        log.info("All fed.")
        context.become(done(newData))
      } else {
        val remaining = customers - newData.served
        log.info("{} customers still hungry.", remaining)
        context.become(cooking(newData))
      }

    case _: BurntFood =>
      log.warning("I will not plate this food!")
      context.become(cooking(data))

    case AreYouDone =>
      sender() ! Reply(data.served, isDone = false)
  }

  def done(data: Data): Receive = {
    case AreYouDone =>
      sender() ! Reply(data.served, isDone = true)
  }
}
```

Once the manager is introduced to a chef, the manager polls the chef periodically until 
the chef is done. The manager is a stateful actor itself.
Its polling is implemented with [timers](https://doc.akka.io/docs/akka/current/actors.html#timers-scheduled-messages).

```scala
class Manager() extends Actor with ActorLogging with Timers {

  def receive: Receive = emptyKitchen

  def emptyKitchen: Receive = {
    case Introduce(chef: ActorRef) =>
      timers.startPeriodicTimer("pollTimer", Poll, 500 millis)
      context.become(managing(chef))
  }

  def managing(chef: ActorRef): Receive = {
    case Poll =>
      implicit val timeout = Timeout(2 seconds)
      pipe(chef ? AreYouDone) to self

    case Reply(served, isDone) =>
      if (isDone) {
        log.info("The chef is done for the day, all {} customers served!", served)
        timers.cancel("pollTimer")
        context.become(emptyKitchen)
      } else {
        log.info("The chef is not done yet.")
      }
  }
}
```

Once initialized with a set of cooking skills and a number of customers,
the chef can be introduced to the manager and be given `Ingredients`. Here is the main App:

```scala
object CookingApp extends App {
  val system = ActorSystem()

  val propsManager = Props(new Manager())
  val manager = system.actorOf(propsManager, "manager")

  // Burns food when cooking ingredients with servings over 5
  val cookingSkill = DistractedNovice()
  val props = Props(new Chef(customers = 5, cookingSkill))
  val chef = system.actorOf(propsUntyped, "chef")

  manager ! Introduce(chef)

  chef ! Ingredients(servings = 9) // burnt
  system.scheduler.scheduleOnce(1 second) {
    chef ! Ingredients(servings = 3)
    chef ! Ingredients(servings = 2)
  }(system.dispatcher)
}
```

And the following scene plays out on the console:

```
[INFO] [akka://default/user/chef] Cooking 9 servings.
[WARN] [akka://default/user/chef] Burnt 9 servings.
[INFO] [akka://default/user/manager] The chef is not done yet.
[INFO] [akka://default/user/chef] Cooking 3 servings.
[INFO] [akka://default/user/chef] Cooking 2 servings.
[INFO] [akka://default/user/manager] The chef is not done yet.
[INFO] [akka://default/user/chef] Plating 3 servings.
[INFO] [akka://default/user/chef] 2 customers still hungry.
[INFO] [akka://default/user/chef] Plating 2 servings.
[INFO] [akka://default/user/chef] All fed.
[INFO] [akka://default/user/manager] The chef is done for the day, all 5 customers served!
```

## Untyped FSM Actor


This `ChefSM` (pun intended) leverages the [FSM mixin](https://doc.akka.io/docs/akka/current/fsm.html).
It looks a bit different with predefined states and data.

```scala
object ChefSM {
  sealed trait State
  case object Cooking extends State
  case object Plating extends State
  case object Done extends State
}

class ChefSM(customers: Int, skill: CookingSkill)
  extends FSM[State, Data] {
  import ChefSM._

  startWith(Cooking, Data(served = 0))

  when(Cooking) {
    case Event(ing: Ingredients, _) =>
      pipe(skill.cook(ing)) to self
      stay

    case Event(cooked: CookedFood, _) =>
      self ! cooked
      goto(Plating)

    case Event(_: BurntFood, _) =>
      stay

    case Event(AreYouDone, Data(served)) =>
      sender() ! Reply(served, isDone = false)
      stay
  }

  when(Plating) {
    case Event(CookedFood(servings), data) =>
      val newData = Data(data.served + servings)
      if (newData.served >= customers) {
        goto(Done) using newData
      } else {
        goto(Cooking) using newData
      }

    case Event(_: BurntFood, _) =>
      goto(Cooking)

    case Event(AreYouDone, Data(served)) =>
      sender() ! Reply(served, isDone = false)
      stay
  }

  when(Done) {
    case Event(AreYouDone, Data(served)) =>
      sender() ! Reply(served, isDone = true)
      stay
  }

  initialize()
}
```

While the above implementation mirrors the function of the untyped version, there are other notable additional features provided by the `FSM` mixin too. I'll be discussing three: 

* [onTransition](#untyped-fsm-ontransition)
* [whenUnhandled](#untyped-fsm-whenunhandled)
* [subscribing to transitions](#untyped-fsm-subscribing-to-transitions)

[See more in the Akka docs](https://doc.akka.io/docs/akka/current/fsm.html).
Note that testing with `FSM` is more powerful as well, discussed in a Part 2.

#### Untyped FSM: `onTransition`
If one wanted to log a message upon transition of from plating to cooking, the 
[onTransition](https://doc.akka.io/docs/akka/current/fsm.html#internal-monitoring)
handler becomes useful:

```scala
onTransition {
  case Plating -> Cooking =>
    log.info("Back to cooking..")
}
```

Without this, one would need to log both upon handling `BurntFood` and `CookedFood` 
in the plating state. This becomes convenient if one needed to do more complicated 
actions, like managing state specific timer 
(e.g. a cooking timer that needs to be cancelled when transitioning out of that state).

#### Untyped FSM: `whenUnhandled`

The `skill.cook()` returns a `Future[Food]` with the `Food` result piped to itself.
To handle a potential failed future–messaged in a `akka.actor.Status.Failure`–one can 
conveniently leverage [whenUnhandled](https://doc.akka.io/docs/akka/current/fsm.html#unhandled-events) to capture, generically, 
not only the error but also the state of the actor when received:

```scala
whenUnhandled {
  case Event(Status.Failure(cause), data) =>
    log.warning("Unhandled error while {} with {} customers served: {}",
      stateName, data.served, cause)
    stay
}
```

Alternatively, one would need to add handling of this case at every state.

#### Untyped FSM: Subscribing to Transitions

In the untyped example, the manager actor polls until the chef is done. 
`FSM` conveniently provides the ability to [subscribe to state transitions](https://doc.akka.io/docs/akka/current/fsm.html#external-monitoring). 
This means the subscribed manager can listen for state changes from the chef 
rather than constantly polling:

```scala
class ManagerFSM() extends Actor with ActorLogging {
  def receive: Receive = emptyKitchen

  def emptyKitchen: Receive = {
    case Introduce(chef: ActorRef) =>
      chef ! SubscribeTransitionCallBack(context.self)
      context.become(listening(chef))
  }

  def listening(chef: ActorRef): Receive = {
    case CurrentState(_, ChefSM.Done) | Transition(_, _, ChefSM.Done) =>
      log.info("The chef is done for the day!")
      chef ! UnsubscribeTransitionCallBack(context.self)
      context.become(emptyKitchen)
  }
}
```

The interaction now looks more efficient:

```
[INFO] [akka://default/user/chef] Cooking 9 servings.
[WARN] [akka://default/user/chef] Burnt 9 servings.
[INFO] [akka://default/user/chef] Cooking 3 servings.
[INFO] [akka://default/user/chef] Cooking 2 servings.
[INFO] [akka://default/user/chef] Plating 2 servings.
[INFO] [akka://default/user/chef] 3 customers still hungry
[INFO] [akka://default/user/chef] Plating 3 servings.
[INFO] [akka://default/user/chef] All fed.
[INFO] [akka://default/user/manager] The chef is done for the day!
```

While neat, [note that a stopped manager will not terminate the subscription](https://doc.akka.io/docs/akka/current/fsm.html#external-monitoring),
so that is the subscriber's responsibility.


## Typed Actor

It's exciting to see the [Akka typed ecosystem](https://doc.akka.io/docs/akka/current/typed/index.html) maturing to production-readiness.
While discussing all the differences with untyped actor module is outside of the scope of this post,
I'll attempt to portray the significant parts with the chef and manager scenario.

First, the `AreYouDone` and `Introduce` messages need to change to include the typed 
`ActorRef[T]` where `T` is the type of messages the actor can receive.
`sender()` is not available in typed. 

```scala
// chef
final case class AreYouDone(replyTo: ActorRef[Reply]) extends ChefMsg

// manager
final case class Introduce(chef: ActorRef[ChefMsg]) extends ManagerMsg
```

States can be represented as `Behaviors`.
State data can be passed as parameters similar to untyped `context.become` pattern shown above.

```scala
class ChefTyped(customers: Int, skill: CookingSkill) extends StrictLogging {
  val behavior: Behavior[ChefMsg] = cooking(Data(served = 0))

  def cooking(data: Data): Behavior[ChefMsg] =
    Behaviors.receivePartial[ChefMsg] {
      case (ctx, ing @ Ingredients(servings)) =>
        logger.info(s"Cooking $servings servings.")
        skill
          .cook(ing)
          .onComplete {
            case Success(food) =>
              ctx.self ! food // safe with typed
            case Failure(ex) =>
              logger.warn(s"error while cooking with ${data.served} customers served: ${ex.getMessage}")
          }(ctx.executionContext)
        Behaviors.same

      case (ctx, cooked: CookedFood) =>
        ctx.self ! cooked
        plating(data)

      case (_, BurntFood(servings)) =>
        logger.warn(s"Burnt $servings servings.")
        cooking(data)

      case (_, AreYouDone(replyTo)) =>
        replyTo ! Reply(data.served, isDone = false)
        Behaviors.same
    }

  def plating(data: Data): Behavior[ChefMsg] =
    Behaviors.receiveMessagePartial[ChefMsg] {
      case CookedFood(servings) =>
        logger.info(s"Plating $servings servings.")
        val newData = Data(data.served + servings)
        if (newData.served >= customers) {
          logger.info("All fed.")
          done(newData)
        } else {
          val remaining = customers - newData.served
          logger.info(s"$remaining customers still hungry.")
          cooking(newData)
        }

      case _: BurntFood =>
        logger.warn("I will not plate this food!")
        cooking(data)

      case AreYouDone(replyTo) =>
        replyTo ! Reply(data.served, isDone = false)
        Behaviors.same
    }

  def done(data: Data): Behavior[ChefMsg] =
    Behaviors.receiveMessagePartial[ChefMsg] {
      case AreYouDone(replyTo) =>
        replyTo ! Reply(data.served, isDone = true)
        Behaviors.same
    }
}
```

Let's discuss a few interesting things with typed implementation:

* [Compile Time Type Safety](#typed-actor-compile-time-type-safety)
* [Composing Behaviors](#typed-actor-compose-behaviors-with-orelse)
* [Handling Futures](#typed-actor-handling-of-futures)
* [Timers and Asks](#typed-actor-interacting-with-another-actor-via-asks-and-timers)

#### Typed Actor: Compile Time Type Safety

This is the commonly cited benefit. For example, sending a chef a `Reply` 
(not in the `ChefMsg` protocol)  will lead to the following compilation error:

```
[error] .../CookingAppTyped.scala:22:19: type mismatch;
[error]  found   : cooking.manager.Reply
[error]  required: cooking.chef.ChefMsg
[error]       chef ! Reply(served = 8, isDone = false)
[error]                   ^
[error] one error found
[error] (Compile / compileIncremental) Compilation failed
```

#### Typed Actor: Compose Behaviors with `orElse`

Update: **`orElse` is no longer supported as of 2.6.3.**
Refer to [this and associated GitHub issues](https://github.com/akka/akka/issues/27629)
for details.
Note one can still use `PartialFunctions` to layer common cases, but
the types may differ if one is using both `Behaviors.receive` and `Behaviors.receiveMessage`.

The below quoted sections below only applies for Akka Typed 2.5.x.

> Behaviors can be composed with `orElse`.
This means the chef's handling of `AreYouDone` messages can be shared via a common function:

```scala
private def notDone(data: Data): Behavior[ChefMsg]
```

> and appended to the relevant states as seen above.If no case match is found for the message, it falls back to `Behaviors.unhandled` with similar behaviors of the untyped actors. 

Note that if all messages need to be handled explicitly,
one has the option to use `Behaviors.receive` or `Behaviors.receiveMessage` and
provide a total function for handling your message protocol instead.

#### Typed Actor: Handling of Futures

For an untyped actor, the common pattern for handling futures is to 
[pipe the future result](https://doc.akka.io/docs/akka/current/futures.html#use-with-actors)
to another actor or oneself.

```scala
val future = skill.cook(ingredients)
pipe(future) to self // or future pipeTo self
```

In typed, there is no need for piping of futures.
For example, we can accomplish the [previous scenario of handling a failed future](#untyped-fsm-whenunhandled)
like any other future outside of an actor by using `onComplete`.
Notice that closing over the context's `self` reference is 
[also safe](https://github.com/akka/akka/blob/2b6997b7a04d1c085b0c6d0741e555c6fb28df04/akka-actor-typed/src/main/scala/akka/actor/typed/scaladsl/ActorContext.scala#L54-L55)
similar to that of the [untyped](https://doc.akka.io/docs/akka/2.2.3/general/jmm.html#Actors_and_shared_mutable_state) `self` reference.

```scala
def cooking(data: Data): Behavior[ChefMsg] =
  Behaviors.receivePartial[ChefMsg] {
    case (ctx, ing @ Ingredients(servings)) =>
      logger.info(s"Cooking $servings servings.")
      skill
        .cook(ing)
        .onComplete {
          case Success(food) =>
            ctx.self ! food // safe with typed
          case Failure(ex) =>
            logger.warn(s"error while cooking with ${data.served} customers served: ${ex.getMessage}")
        }(ctx.executionContext)
      Behaviors.same
// ...
```

This also means upon error handling we can work with 
`scala.util.{Success, Failure}` and we don't have to remember that
the error results in `akka.actor.Status.Failure`.


#### Typed Actor: Interacting with Another Actor via `asks` and Timers

For the manager using `asks`, I extend its protocol again for the failure case of the ask (e.g. timeout): 

```scala
final case class UnsuccessfulReply(cause: Throwable) extends ManagerMsg
```

Here is the typed manager with a timer mirroring the
functionality of the untyped version discussed above.
The manager polls until the chef is done.

```scala
object ManagerTyped extends StrictLogging {
  val emptyKitchen =
    Behaviors.withTimers[ManagerMsg] { timers =>
      Behaviors.receiveMessagePartial {
        case IntroduceTyped(chef) =>
          timers.startTimerWithFixedDelay("pollTimer", Poll, 500 millis)
          managing(timers, chef)
      }
    }

  private def managing(timers: TimerScheduler[ManagerMsg], chef: ActorRef[ChefMsg]): Behavior[ManagerMsg] =
    Behaviors.receivePartial {
      case (ctx, Poll) =>
        implicit val timeout = Timeout(2 seconds)
        ctx.ask[ChefMsg, ManagerMsg](chef, self => AreYouDone(self)) {
          // These messages will in turn be received by self.
          case Success(reply) =>
            reply
          case Failure(ex) =>
            logger.warn(s"Future failed: $ex")
            UnsuccessfulReply(ex)
        }
        Behaviors.same

      case (_, Reply(served, isDone)) =>
        if (isDone) {
          logger.info(s"The chef is done for the day, all $served customers served!")
          timers.cancel("pollTimer")
          emptyKitchen
        } else {
          logger.info("The chef is not done yet.")
          Behaviors.same
        }
    }
}
```

As of this writing there is no out-of-the-box 
[subscription of transitions](#untyped-fsm-subscribing-to-transitions) 
like the untyped FSM actor that allows for transition events to be pushed to the manager.

The main function to start the interaction of the chef and manager looks like this:

```scala
object CookingAppTyped extends App {
  val main: Behavior[NotUsed] =
    Behaviors.setup { ctx ⇒
      val manager = ctx.spawn(ManagerTyped.emptyKitchen, "manager")

      // Burns food when cooking ingredients with servings over 5
      val cookingSkill = DistractedNovice()
      val chefTemplate = new ChefTyped(5, cookingSkill)
      val chef = ctx.spawn(chefTemplate.behavior, "chef")

      manager ! IntroduceTyped(chef)

      chef ! Ingredients(9) // burnt
      ctx.system.scheduler.scheduleOnce(delay = 1.second, new Runnable() {
        override def run(): Unit = {
          chef ! Ingredients(3)
          chef ! Ingredients(2)
        }
      })(ctx.system.executionContext)

      Behaviors.empty
    }

  val system = ActorSystem(main, "CookingDemo")
}
```

And we can see the scene play out just like before:

```
INFO chef.ChefTyped - Cooking 9 servings.
WARN chef.ChefTyped - Burnt 9 servings.
INFO manager.ManagerTyped$ - The chef is not done yet.
INFO chef.ChefTyped - Cooking 3 servings.
INFO chef.ChefTyped - Cooking 2 servings.
INFO manager.ManagerTyped$ - The chef is not done yet.
INFO chef.ChefTyped - Plating 2 servings.
INFO chef.ChefTyped - 3 customers still hungry.
INFO chef.ChefTyped - Plating 3 servings.
INFO chef.ChefTyped - All fed.
INFO manager.ManagerTyped$ - The chef is done for the day, all 5 customers served!
```

If you got to this point and are still craving more, refer to the 
[Akka Typed documentation](https://doc.akka.io/docs/akka/current/typed/index.html)
or watch [Konrad](https://twitter.com/ktosopl)'s talk about 
[Networks and Types: The Future of Akka](https://slideslive.com/38908791/networks-and-types-the-future-of-akka)
if you haven't already.


Thank you for reading. I hope this comparison illuminates some interesting
things about Akka actors for you. I find the Akka project fun to study and
work with–so here's a shoutout to the Akka Team at Lightbend for their great work.
