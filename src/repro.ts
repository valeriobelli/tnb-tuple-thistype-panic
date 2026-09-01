// Nested array binding pattern whose inner pattern has an array-literal default.
//
// The default makes tsgo build the pattern type through
// getTypeFromArrayBindingPattern(..., includePatternInType = true), which clones
// the tuple type with cloneTypeReference(). The clone keeps ObjectFlagsTuple but
// its data is a *TypeReference, so Type.ThisType() dereferences a nil
// *InterfaceType while the bridge serialises the type response.
export const f = (input: [(string | number)[] | undefined]) => {
	const [[stateId] = []] = input

	return stateId
}
