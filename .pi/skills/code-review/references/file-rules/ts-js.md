# TypeScript and JavaScript Rules

Applies to `**/*.{ts,tsx,js,jsx,mjs,cjs}`. Each item is a defect, not a style preference. The tag names
the owning lens.

## Correctness

- [qa] Unreachable code: statements after `return` or `throw`, or a branch whose condition is constant.
- [qa] A value read or destructured with no null or undefined check where the type or caller lets it be
  missing.
- [qa] A misspelled property, prop, or option name the type system cannot catch (`any`, JSON input,
  untyped objects).
- [qa] A promise that is not awaited, returned, or caught: the error is lost and ordering breaks.
- [qa] An async rejection that escapes into a caller with no handler (event handlers, timers, top-level
  scripts).
- [qa] Dependent async steps run in parallel, or independent ones run one by one in a loop on a hot path.
- [code_quality] `any`, `as` casts, or non-null `!` that hide a real type mismatch at a boundary.
- [code_quality] Declared but unread variables or imports, and large commented-out blocks.

## React

- [qa] A hook called conditionally, in a loop, or outside a component or custom hook.
- [qa] An effect or memo with a missing or stale dependency, or a subscription with no cleanup.
- [qa] Side effects (fetch, DOM writes, subscriptions) in the render body.

## Security

- [security] User-controlled text reaching `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `dangerouslySetInnerHTML`, or `document.write` without escaping.
- [security] `eval`, `new Function`, or a string argument to `setTimeout` or `setInterval`.
- [security] User input in a URL path, file path, shell command, or query without validation or encoding
  (for example a path segment built without `encodeURIComponent`).
- [security] Writes to `Object.prototype` or `Array.prototype`, or untrusted keys (`__proto__`,
  `constructor`) merged into objects.
- [security] API keys, tokens, or credentials in source or in a client bundle.
