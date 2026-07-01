# Raw Units

These are my initial units and required outcomes.
You may split, merge, or reorder them if needed so each final unit is a focused
10-minute lesson.

## Input Unit 1
Title:
Async and Promises (everything)

Required outcome:
The learner should be able to understand why async code exists AND what a Promise
is AND how to use `.then`/`.catch`.

Raw content:
- Synchronous code runs line by line and blocks; a slow operation freezes everything.
- The browser uses callbacks/async so the UI stays responsive.
- A Promise represents a value that is not available yet.
- A Promise is in one of three states: pending, fulfilled, rejected.
- `.then(onFulfilled)` runs when it fulfills; `.catch(onRejected)` runs when it rejects.
- Promises can be chained; each `.then` returns a new Promise.

Examples:
- `fetch(url)` returns a Promise.
- `new Promise((resolve, reject) => { ... })`.

Common mistakes if known:
- Thinking the value is available immediately (synchronously).
- Forgetting to handle rejection with `.catch`.
- Confusing "pending" with "rejected".

## Input Unit 2
Title:
Chaining (tiny)

Required outcome:
The learner should be able to chain two `.then` calls.

Raw content:
- Returning a value from `.then` passes it to the next `.then`.
