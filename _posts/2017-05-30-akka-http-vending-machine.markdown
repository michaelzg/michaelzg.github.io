---
layout: post
title:  "Akka HTTP Server Part 1: Soda Vending Machine"
date:   2017-05-30 00:00:00
categories: akka
published: false
---

This post--Part 1 of 2--aims to demonstrate one way of using [Akka-HTTP](http://doc.akka.io/docs/akka-http/current/scala.html) by implementing an API for a soda vending machine. All the code, including instructions for building, is [in a sub-module of my akka-playground project.](https://github.com/michaelzg/vending-machine-http-api).

Walking through this little program, I'll highlight:

* Unmarshallers for cleanly parsing request queries into pre-defined case classes.
* Routing structures defined as a trait and the benefit of extendability. 
* Use of an actor to encapsulate state (e.g. the soda inventory and payments), analagous to a database.

The API has the following routes:

|Method|Route & Query String|Functionality|
|---|---|---|---|
|GET|`/`|Welcome message.|
|GET|`/buy`|Check the inventory and price of sodas currently available|
|GET|`/history?last=<int>`|Return the ledger, can be limited to the last N|
|POST|`/buy`|Buy soda. If there isn't enough money in the first POST, store the state so the user can keep feeding money!|
|DELETE|`/buy`|Dispense all the change and cancel the transaction|

I'll first provide an overview of the application layout. Then, with the implementations of each method I'll showcase the useful tools that Akka and scala provide when building an HTTP server.

### Layout

```
scala/
  Domain/
    <concepts and data models for managing the vending machine>
  
  Requests/
    <interface with pre-defined methods of interacting with the API. The anti-corruption layer>
  
  Responses/
    <formatters for the JSON response>
  
  Routes/
    Handlers/
      <exception and rejection handlers, provides helpful error responses>
    
    VendingMachineHttpRouteService.scala
  
  VendingMachineHttpApp.scala
```

Above is the layout of packages in `/src/main/scala`, following the [Maven standard layout](https://maven.apache.org/guides/introduction/introduction-to-the-standard-directory-layout.html). 

The `VendingMachineHttpApp` is essentially application `main`: it brings the routes to life through extending the `VendingMachineHttpRouteService`, kicks off the vending machine actor (discussed in the next section), reads configurations, and kicks off the server. It's a rather terse piece of code:

```scala
object VendingMachineHttpApp extends App with VendingMachineHttpRouteService {
  implicit val system = ActorSystem()
  implicit val materializer = ActorMaterializer()
  //TODO: put in reference.conf?
  val initialSodaInventory: Map[Soda, Int] = Map(
    Sodas.Coke -> 5,
    Sodas.DrPepper -> 6,
    Sodas.Sprite -> 8,
    Sodas.Mystery -> 2
  )
  val vendingMachine = 
    system.actorOf(VendingMachineActor.props(initialSodaInventory), "vending-machine")

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

```scala
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

### GET: `/` route | The Simple Response 

The `rootRoute` leads to it's handler:

```scala
val rootRoute = pathSingleSlash {
  Handlers.VendingMachineApi.handleRootRoute
}
```

and the handler is simple, using Akka's `complete` directive to return a string (or a more customized `HttpResponse` that you can see in the Exception/Rejection handling section).

```scala
def handleRootRoute: Route = 
  complete("Welcome to the Vending Machine HTTP API demo!")
```

### GET: `/buy` | Encapsulating State Through an Actor

We come up to the vending machine and would like to know "What can I buy?" Upon hitting the `/shop` endpoint, the route handlers guide the request down to the `handleShopRoute` method where the `vendingMachine` actor is queried for its state using an [Ask](http://doc.akka.io/docs/akka/2.4.16/scala/actors.html#Ask__Send-And-Receive-Future) (note that a separate Actor gets spun up for Asks!).

```scala
def handleShopRoute(vendingMachine: ActorRef): Route = {
  implicit val timeout = Timeout(5 seconds)
  //an Actor gets spun up for this!
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



### POST: `/buy` and DELETE: `/History` Routes | Parsing Fields in the Query String

We want our route definitions clean. Let Akka http unmarshallers help you do that.


### DELETE: `/buy` | Get your money back!

The dispense route shows the parsing of the request and the change of state in the actor. 


### Format the Response on the Way Out

These are done through the `Formatter` class with the `Response` package. 

### Handling Exceptions and Rejections



Thank you for reading! Testing this application will be in Part 2.
