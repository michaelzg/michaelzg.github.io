---
layout: post
title:  "Using Akka HTTP Server Part 1: Soda Vending Machine"
date:   2016-10-30 00:00:00
categories: akka
published: false
---

Want to just see all the code? [Here is the respository on my Github](https://github.com/michaelzg/vending-machine-http-api).

This post--the first of two--aims to demonstrate one way of using [Akka HTTP](http://doc.akka.io/docs/akka/2.4.11/scala/http/index.html) by implementing an API for a soda vending machine. I'll discuss tests in the second. But in this first one, I highlight some useful features that Scala and Akka provide: 

* Unmarshallers for cleanly parsing request queries into pre-defined case classes.
* Routing structures defined as a trait and the benefit of extendability. 
* Use of an actor to encapsulate state (e.g. the soda inventory and payments), analagous to a database.

One will be able to interact with the Soda Vending Machine through the following methods:

|Method|Route & Query String|Functionality|
|---|---|---|---|
|GET|`/`|Welcome message.|
|GET|`/shop`|Check the inventory and price of sodas currently available|
|GET|`/history?last=<int>`|Return the ledger, can be limited to the last N|
|POST|`/buy`|Buy soda. If there isn't enough money in the first POST, store the state so the user can keep feeding money!|
|DELETE|`/dispense?id=<int>`|Dispense all the change and cancel the transaction|

I'll first provide an overview of the application layout. Then, with the implementations of each method I'll showcase the useful tools that Akka and scala provide when building an HTTP server.

### Layout

```
scala/
	Domain/
	Requests/
	Responses/
	Routes/
		Handlers/
		VendingMachineHttpRouteService.scala
	VendingMachineHttpApp.scala
```

Above is the layout of packages in `/src/main/scala`, following the [Maven standard layout](https://maven.apache.org/guides/introduction/introduction-to-the-standard-directory-layout.html). Here is a bird's-eye-summary-view of each package:

* `Domain` defines concepts relevant to a soda vending machine. The data model for what it means to be a "soda" within a vending machine are defined here. Also, the `VendingMachineActor` implementing the management of state (e.g. soda's being bought, inventories changing) lives here as well. 
* `Requests` is the interface with pre-defined methods of interacting with the API. Requests first get parsed into case classes here, and bad requests are not to get passed this layer! 
* `Responses` have the formatters for turning data that the API wants to communicate back to the user into a serialized JSON response. 
* `Routes` not only harbor route _handlers_ that contain all logic for turning a user's request into a response but also provides exception and request rejection handlers so response are _helpful_ and informative to the user.. not just a blank `500` Internal Server Error! The `VendingMachineHttpRouteService` is an extendable _trait_ where routes are defined and handlers do their handling. This extendability is beneficial for easily _reusing_ the routes in tests.
* `VendingMachineHttpApp` is essentially application `main`: it brings the routes to life through extending the `VendingMachineHttpRouteService`, kicks off the vending machine actor (discussed in the next section), reads configurations, and kicks off the server. It's a rather terse piece of code:

```
object VendingMachineHttpApp extends App with VendingMachineHttpRouteService {
  implicit val system = ActorSystem()
  implicit val materializer = ActorMaterializer()
  val initialSodaInventory: Map[Soda, Int] = Map(
    Sodas.Coke -> 5,
    Sodas.DrPepper -> 6,
    Sodas.Sprite -> 8,
    Sodas.Mystery -> 2
  )
  val vendingMachine = system.actorOf(VendingMachineActor.props(initialSodaInventory), "vending-machine")

  val params = ConfigFactory.load()
  val config = params.getConfig("vending-machine-http-api")
  val host = config.getString("host")
  val port = config.getInt("port")

  val binding = Http().bindAndHandle(route, host, port)
  sys.addShutdownHook{
    binding.flatMap(_.unbind()).onComplete{ _ => system.terminate()}
  }
}
```  

It is short because most of the application logic is hidden away in layers where responsibility of the code gets finer-grained the deeper you go. The layer directly underneath this "main" function is the `routes` that is defined within the `VendingMachineHttpRouteService`:

```
val routes =
    handleExceptions(exceptionHandler) {
      handleRejections(rejectionHandler) {
        get {
          rootRoute ~
            shopRoute
        }
      }
    }
```

Note that in an effort to make the routes defined in `VendingMachineHttpRouteService` _clean_, without cluttering it with too much route handling logic, every route gets handled by a route handler within `Routes.Handlers`. We'll take a tour of each route handler in the following sections, starting with the root route.

### Root route: The Simple Response 

The `rootRoute` leads to it's handler:

```
val rootRoute = pathSingleSlash {
	Handlers.VendingMachineApi.handleRootRoute
}
```

and the handler is simple, using Akka's `complete` directive to return a string (or a more customized `HttpResponse` that you can see in the Exception/Rejection handling section).

```
def handleRootRoute: Route = complete("Welcome to the Vending Machine HTTP API demo!")
```

### Shop Route: Encapsulating State Through an Actor

We come up to the vending machine and would like to know "What can I buy?" Upon hitting the `/shop` endpoint, the route handlers guide the request down to the `handleShopRoute` method:

```
def handleShopRoute(vendingMachine: ActorRef): Route = {
    implicit val timeout = Timeout(5 seconds)
    //note performance overhead for asks
    val inventory = vendingMachine ? CheckInventory

    onComplete(inventory) {
      case Success(result) =>
        val sodasInStock = result.asInstanceOf[Map[Soda, Int]]
        val response = Formatter.formatShopResponse(sodasInStock)
        complete(response)
      case Failure(ex) =>
        throw ex //caught in Exception Handler
    }
```




### Buy and History Route: Parsing Fields in the Query String

We want our route definitions clean. Let Akka http unmarshallers help you do that.


### Dispense Route: Tying it all together.

The dispense route shows the parsing of the request and the change of state in the actor. 


### Keep response formatting until the very end

These are done through the `Formatter` class with the `Response` package. 

### Handling Exceptions and Rejections



Thank you for reading! Testing this application will be Part 2 of this 2-part blog series.
