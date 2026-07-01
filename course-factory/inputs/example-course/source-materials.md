# Source Materials

Paste any source material here.

This may include:
- notes
- explanations
- definitions
- examples
- existing lesson content
- copied articles
- exercises
- common mistakes
- terminology

Raw material:

## The blocking problem
JavaScript runs on a single thread. If a function takes a long time (e.g. waiting
for a network response) and runs synchronously, nothing else can happen — the
page freezes, clicks do nothing. Asynchronous code lets the program start a slow
task and keep responding, then handle the result later.

## What a Promise is
A Promise is an object representing the eventual completion (or failure) of an
asynchronous operation and its resulting value. Think of it as a receipt: you
don't have the meal yet, but you have something that will resolve into the meal
(or an apology if the kitchen fails).

## The three states
- pending: initial state, neither fulfilled nor rejected.
- fulfilled: the operation completed successfully, producing a value.
- rejected: the operation failed, producing a reason (error).
A Promise "settles" once it is fulfilled or rejected, and never changes again.

## Consuming a Promise
```js
fetch('/data.json')
  .then((response) => response.json()) // runs on fulfillment
  .catch((error) => console.error(error)); // runs on rejection
```

## Creating a Promise
```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
wait(1000).then(() => console.log('one second passed'));
```

## Terminology
- resolve: settle a Promise successfully.
- reject: settle a Promise with an error.
- settle: reach fulfilled or rejected (final).

## Common mistakes
- Treating the Promise's value as available synchronously.
- Forgetting `.catch`, so rejections become unhandled.
- Believing a settled Promise can change state later.
