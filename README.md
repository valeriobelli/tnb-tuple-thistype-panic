# TNB panic: `Type.ThisType()` nil dereference on cloned tuple references

Minimal reproduction for a native crash in [`typescript-native-bridge`](https://github.com/johnsoncodehk/typescript-native-bridge).

A type-aware ESLint rule asks the checker for the type of an array-literal default
inside a **nested array binding pattern**. The bridge panics while serialising the
type response, and the whole ESLint process dies with `SIGSEGV`.

## Reproduce

```bash
npm install
npm run repro
```

Output:

```
▎ TNB ACTIVE — `typescript` is the tsgo-backed fork
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x2 addr=0xf8 pc=0x1206b4d98]

goroutine 17 [running, locked to thread]:
github.com/microsoft/typescript-go/internal/checker.(*Type).ThisType(...)
	typescript-go/internal/checker/types.go:754
github.com/microsoft/typescript-go/internal/api.newTypeResponse(0xa7af36ab880, 0x91)
	typescript-go/internal/api/proto.go:1130 +0x198
github.com/microsoft/typescript-go/internal/api.(*snapshotData).newTypeResponse(...)
	typescript-go/internal/api/session.go:455 +0x34
github.com/microsoft/typescript-go/internal/api.checkerSetup.newTypeResponse(...)
	typescript-go/internal/api/session.go:741
github.com/microsoft/typescript-go/internal/api.(*Session).handleGetTypeAtLocation(...)
	typescript-go/internal/api/session.go:2844 +0xd8
github.com/microsoft/typescript-go/internal/api.(*Session).handleArenaRequest(...)
	typescript-go/internal/api/arena_dispatch.go:139 +0x2a04
github.com/microsoft/typescript-go/internal/api.(*Session).HandleArenaRequest(...)
	typescript-go/internal/api/arena_dispatch.go:98 +0x78
main.BridgeCallArena(...)
	typescript-go/bridge/bridge.go:442 +0x158
```

Process exits with code `134`. Stock `typescript` (no override) reports no error.

## Trigger

[`src/repro.ts`](src/repro.ts) — nested array binding pattern with an array-literal default:

```ts
export const f = (input: [(string | number)[] | undefined]) => {
	const [[stateId] = []] = input

	return stateId
}
```

Any type-aware rule that calls `checker.getTypeAtLocation()` on the `[]` initializer
triggers it; this repro uses `@typescript-eslint/no-unsafe-assignment`, the smallest one.

## Affected versions

| version | result |
| --- | --- |
| `6.0.3-bridge.9.tsgo.7.0.2` | ok |
| `6.0.3-bridge.10.tsgo.7.0.2` | **panic** (first bad) |
| `6.0.3-bridge.15.tsgo.7.0.2` | **panic** |

Bisected by swapping only the `typescript` override in this project.
`bridge.10` is the release that shipped the `thisType` wire field for
[issue #53](https://github.com/johnsoncodehk/typescript-native-bridge/issues/53).

Reproduced on macOS 26.6 (darwin-arm64), Node 24.19.0, ESLint 10.9.1, typescript-eslint 8.69.0.

## Cause

`patches/typescript-go/0001-bridge-inplace.patch` adds the accessor
(built as `internal/checker/types.go:754`):

```go
func (t *Type) ThisType() *Type {
	if t.objectFlags&(ObjectFlagsClassOrInterface|ObjectFlagsTuple) != 0 {
		return t.AsInterfaceType().thisType
	}
	return nil
}
```

and `patches/typescript-go/0004-api-surface.patch` calls it unconditionally in
`newTypeResponse` (`internal/api/proto.go:1130`).

The gate is on **object flags**, but flags and data shape can diverge. In tsgo
(`internal/checker/checker.go`, pinned submodule `2bd066d`):

```go
func (c *Checker) cloneTypeReference(source *Type) *Type {
	t := c.newObjectType(ObjectFlagsReference, source.symbol)          // data = *TypeReference
	t.objectFlags = source.objectFlags &^ ObjectFlagsMembersResolved   // re-stamps ObjectFlagsTuple
	t.AsTypeReference().target = source.AsTypeReference().target
	t.AsTypeReference().resolvedTypeArguments = source.AsTypeReference().resolvedTypeArguments
	return t
}
```

A clone of a tuple type therefore carries `ObjectFlagsTuple` while its data is a plain
`*TypeReference`. `Type.AsInterfaceType()` falls through to
`TypeBase.AsInterfaceType()`, which returns `nil`, so `.thisType` dereferences a nil
pointer — the `addr=0xf8` in the signal line is the field offset.

The reachable path here is `getTypeFromArrayBindingPattern(pattern, includePatternInType, reportErrors)`:

```go
result := c.createTupleTypeEx(elementTypes, elementInfos, false)
if includePatternInType {
	result = c.cloneTypeReference(result)
	...
}
```

`includePatternInType` is `true` exactly when the binding pattern has a default, which is
why `const [[stateId] = []] = input` reaches it and `const [[stateId]] = input` does not.

The other `cloneTypeReference` caller, `createArrayLiteralType`, is the same hazard class.

## Suggested fix

Stock TypeScript's `cloneTypeReference` produces an object with no `thisType` property, so
`undefined` is the stock-faithful answer for these clones. Nil-check the accessor:

```diff
 func (t *Type) ThisType() *Type {
 	if t.objectFlags&(ObjectFlagsClassOrInterface|ObjectFlagsTuple) != 0 {
-		return t.AsInterfaceType().thisType
+		if d := t.AsInterfaceType(); d != nil {
+			return d.thisType
+		}
 	}
 	return nil
 }
```

## Workaround

Rewriting the pattern avoids the crash without changing behaviour:

```ts
const [answer] = input
const [stateId] = answer ?? []
```
