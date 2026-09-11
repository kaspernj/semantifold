// @ts-check

/** @typedef {"php" | "ruby" | "javascript" | "typescript" | "java" | "kotlin" | "python" | "csharp" | "go" | "c" | "cpp" | "rust" | "swift"} SemanticLanguage */
/** @typedef {SemanticLanguage} TextBackendLanguage */
/** @typedef {TextBackendLanguage | "wasm"} BackendLanguage */
/** @typedef {SemanticLanguage | "html"} GeneratedTextLanguage */
/** @typedef {"integer" | "boolean" | "string"} SemanticTypeName */
/** @typedef {SemanticTypeName | "void"} FunctionReturnTypeName */
/** @typedef {"IntegerNegate" | "BooleanNot"} SemanticUnaryOperation */
/** @typedef {"IntegerAdd" | "IntegerSubtract" | "IntegerMultiply" | "BooleanAnd" | "BooleanOr" | "IntegerEqual" | "IntegerNotEqual" | "BooleanEqual" | "BooleanNotEqual" | "StringEqual" | "StringNotEqual" | "IntegerLessThan" | "IntegerLessThanOrEqual" | "IntegerGreaterThan" | "IntegerGreaterThanOrEqual" | "StringConcat"} SemanticBinaryOperation */
/** @typedef {"record" | "error" | "field" | "function" | "parameter" | "local" | "iteration" | "catch"} SemanticSymbolKind */
/** @typedef {"record" | "error" | "function"} SemanticDeclarationKind */
/** @typedef {"declaration" | "type" | "construct" | "member" | "read" | "write" | "call"} SemanticSymbolRole */
/** @typedef {"parse" | "generate" | "restore" | "compile" | "link" | "validate" | "instantiate" | "execute"} AcceptanceStage */
/** @typedef {"entry" | "source" | "manifest" | "support" | "mapping" | "resource" | "loader"} GeneratedArtifactRole */

/**
 * @typedef LanguageRoleCapabilities
 * @property {boolean} frontend - Parser adapter availability.
 * @property {boolean} textBackend - Single- or multi-file text backend availability.
 * @property {boolean} binaryBackend - Binary backend availability.
 * @property {boolean} applicationBackend - Application-artifact backend availability.
 * @property {boolean} interoperability - Interoperability bridge availability.
 */

/**
 * @typedef LanguageMappingCapabilities
 * @property {boolean} richText - Authoritative rich text mappings.
 * @property {boolean} sourceMapV3 - Source Map v3 projection.
 * @property {boolean} binaryRanges - Byte-coordinate binary/resource mappings.
 */

/**
 * @typedef LanguageAcceptanceCapabilities
 * @property {readonly AcceptanceStage[]} stages - Applicable ordered acceptance stages.
 * @property {readonly string[]} toolchains - Required canonical toolchain IDs.
 */

/**
 * @typedef LanguageFeatureCapabilities
 * @property {boolean} generalFunctionsAndCalls - Task 005 arbitrary required signatures, resolved direct calls, and void functions.
 * @property {boolean} immutableCollections - Task 006 recursive immutable lists/maps, total access, and size.
 * @property {boolean} optionalValues - Task 007 explicit optional values, presence tests, and guarded unwrap.
 * @property {boolean} orderedListIteration - Task 008 ordered immutable-list iteration and nearest-loop control.
 * @property {boolean} closedRecords - Task 009 nominal closed immutable records, construction, and member reads.
 * @property {boolean} typedErrors - Task 011 nominal unchecked errors, raises, and exact typed catches.
 */

/**
 * @typedef LanguageCapabilities
 * @property {string} id - Stable registry identity.
 * @property {Readonly<LanguageRoleCapabilities>} roles - Independently registered roles.
 * @property {"single" | "multiple"} artifactMultiplicity - Target artifact multiplicity.
 * @property {boolean} roundTrip - Whether frontend/backend round-trip acceptance is declared.
 * @property {Readonly<LanguageFeatureCapabilities>} features - Semantic feature capabilities.
 * @property {Readonly<LanguageMappingCapabilities>} mapping - Mapping forms.
 * @property {Readonly<LanguageAcceptanceCapabilities>} acceptance - Stages and toolchains.
 */

/**
 * @typedef SourcePoint
 * @property {number} line - One-based line.
 * @property {number} column - One-based UTF-16 code-unit column.
 * @property {number} offset - Zero-based UTF-16 source offset.
 */

/**
 * @typedef SourceLocation
 * @property {string} filename - Originating filename.
 * @property {SourcePoint} start - Inclusive start.
 * @property {SourcePoint} end - Exclusive end.
 */

/**
 * @typedef RegisteredSource
 * @property {string} id - Registry-local deterministic source identity.
 * @property {string} filename - Original filename, preserved verbatim.
 * @property {string | null} content - Original source content, preserved verbatim when available.
 * @property {SemanticLanguage | null} language - Parser language when known.
 */

/**
 * @typedef SourceOrigin
 * @property {"source"} kind - Direct source provenance.
 * @property {string} sourceId - Registered source identity.
 * @property {SourceLocation} location - Exact original range.
 */

/**
 * @typedef RelatedOrigin
 * @property {string} sourceId - Registered source identity.
 * @property {SourceLocation} location - Related original range.
 * @property {string} [nodeId] - Related semantic node identity.
 * @property {string} [symbolId] - Related semantic symbol identity.
 * @property {string} [role] - Relationship role.
 */

/**
 * @typedef DerivedOrigin
 * @property {"derived"} kind - Provenance derived from one or more origins.
 * @property {RelatedOrigin[]} origins - Ordered, non-empty original ranges.
 */

/**
 * @typedef SyntheticOrigin
 * @property {"synthetic"} kind - Source-free generated or semantic scaffolding.
 * @property {string} reason - Stable human-readable reason.
 * @property {RelatedOrigin[]} relatedOrigins - Ordered related ranges, possibly empty.
 */

/** @typedef {SourceOrigin | DerivedOrigin | SyntheticOrigin} SemanticOrigin */

/**
 * @typedef GeneratedByteRange
 * @property {{start: number, end: number}} generated - Half-open generated byte offsets.
 * @property {SemanticOrigin} origin - Semantic or explicit synthetic provenance.
 * @property {string} [nodeId] - Originating semantic node identity.
 * @property {string} [symbolId] - Originating semantic symbol identity.
 * @property {string} [role] - Semantic or binary-region role.
 */

/**
 * @typedef SemantifoldByteMapping
 * @property {"SemantifoldByteMapping"} schema - Schema discriminator.
 * @property {1} version - Schema version.
 * @property {"bytes"} coordinateSystem - Generated offsets are bytes, never text columns.
 * @property {{path: string, byteLength: number}} generated - Generated artifact identity.
 * @property {readonly GeneratedByteRange[]} ranges - Ordered non-overlapping ranges.
 */

/**
 * @typedef SemanticNodeSourceProvenance
 * @property {"SemantifoldNodeProvenance"} schema - Association discriminator.
 * @property {1} version - Association version.
 * @property {SemanticOrigin} origin - Source association independent of traversal position.
 * @property {Readonly<Record<string, SourceLocation>>} ranges - Exact semantic-token subranges by role.
 */

/**
 * @typedef SemanticNodeProvenance
 * @property {string} id - Deterministic module-local node identity.
 * @property {string} path - JSON Pointer from the semantic module root.
 * @property {SemanticNode["kind"] | "TypeReference"} kind - Semantic node kind.
 * @property {SemanticOrigin} origin - Closed provenance value.
 * @property {Readonly<Record<string, SourceLocation>>} ranges - Exact semantic-token subranges by role.
 * @property {string} [symbolId] - Resolved declared/referenced symbol identity.
 */

/**
 * @typedef SemanticSymbolReference
 * @property {string} nodeId - Referring semantic node identity.
 * @property {SemanticSymbolRole} role - Reference role.
 * @property {SourceLocation} location - Exact reference range.
 */

/**
 * @typedef SemanticSymbolProvenance
 * @property {string} id - Deterministic module-local symbol identity.
 * @property {string} name - Semantic symbol name.
 * @property {SemanticSymbolKind} kind - Symbol category.
 * @property {string} declarationNodeId - Declaring node identity.
 * @property {string} [semanticDeclarationId] - Stable semantic declaration identity for record, field, and function symbols.
 * @property {SourceLocation} location - Exact declaration-name range.
 * @property {SemanticSymbolReference[]} references - Ordered resolved references.
 */

/**
 * @typedef SemanticProvenance
 * @property {"SemantifoldProvenance"} schema - Schema discriminator.
 * @property {1} version - Schema version.
 * @property {"utf16"} coordinateSystem - Offset and column unit.
 * @property {RegisteredSource[]} sources - Versioned source registry.
 * @property {SemanticNodeProvenance[]} nodes - Deterministic node index.
 * @property {SemanticSymbolProvenance[]} symbols - Deterministic symbol index.
 */

/** @typedef {"exact" | "anchor" | "synthetic"} MappingKind */

/**
 * @typedef SemantifoldMappingSpan
 * @property {SourceLocation} generated - Generated half-open range.
 * @property {MappingKind} mappingKind - Mapping precision.
 * @property {SemanticOrigin} origin - Closed original provenance.
 * @property {string} [nodeId] - Related canonical semantic node.
 * @property {string} [symbolId] - Related canonical semantic symbol.
 * @property {string} [role] - Semantic token role.
 * @property {string} [name] - Useful symbol name for Source Map v3.
 */

/**
 * @typedef GeneratedSource
 * @property {string} filename - Output filename.
 * @property {GeneratedTextLanguage} language - Output text language.
 * @property {string} content - Exact generated LF source.
 */

/**
 * @typedef SemantifoldMapping
 * @property {"SemantifoldMapping"} schema - Schema discriminator.
 * @property {1} version - Schema version.
 * @property {"utf16"} coordinateSystem - Offset and column unit.
 * @property {GeneratedSource} generated - Generated program identity and content.
 * @property {RegisteredSource[]} sources - Original source registry.
 * @property {SemanticNodeProvenance[]} nodes - Canonical semantic node index.
 * @property {SemanticSymbolProvenance[]} symbols - Canonical semantic symbol index.
 * @property {SemantifoldMappingSpan[]} spans - Ordered generated ranges.
 */

/**
 * @typedef GeneratedArtifact
 * @property {string} code - Generated output program, including any requested directive.
 * @property {string} filename - Generated output filename.
 * @property {SemanticLanguage} language - Output language.
 * @property {SemantifoldMapping} mapping - Authoritative rich mapping.
 * @property {import("@jridgewell/gen-mapping").EncodedSourceMap} sourceMap - Source Map v3 projection.
 * @property {string} sourceMapFilename - Default external Source Map filename.
 */

/**
 * @typedef TextArtifactProvenance
 * @property {"text"} kind - Rich text provenance discriminator.
 * @property {SemantifoldMapping} mapping - Authoritative range mapping.
 * @property {import("@jridgewell/gen-mapping").EncodedSourceMap} sourceMap - Interoperable projection.
 * @property {string} [sourceMapFilename] - Logical Source Map sidecar path.
 */

/**
 * @typedef ByteArtifactProvenance
 * @property {"bytes"} kind - Byte provenance discriminator.
 * @property {SemantifoldByteMapping} mapping - Authoritative byte ranges.
 */

/**
 * @typedef ArtifactSyntheticProvenance
 * @property {"synthetic"} kind - Synthetic artifact discriminator.
 * @property {string} reason - Explicit target-scaffolding reason.
 * @property {readonly RelatedOrigin[]} relatedOrigins - Related semantic source ranges.
 */

/** @typedef {TextArtifactProvenance | ByteArtifactProvenance | ArtifactSyntheticProvenance} ArtifactProvenance */

/**
 * @typedef GeneratedSetArtifact
 * @property {string} path - Unique safe relative POSIX path.
 * @property {"text" | "binary"} contentKind - Content representation.
 * @property {string | Uint8Array} content - Text or a detached copy of the exact generated bytes on every binary read.
 * @property {string} mediaType - Artifact media type.
 * @property {GeneratedArtifactRole} role - Artifact role; exactly one set artifact is entry.
 * @property {"generated"} ownership - Task-015 ownership contract.
 * @property {ArtifactProvenance} provenance - Text, byte-range, or synthetic provenance.
 */

/**
 * @typedef GeneratedArtifactSet
 * @property {"GeneratedArtifactSet"} schema - Schema discriminator.
 * @property {1} version - Schema version.
 * @property {string} target - Stable language or target ID.
 * @property {string} entry - Path of the sole declared entry artifact.
 * @property {readonly GeneratedSetArtifact[]} artifacts - Deterministic artifact order.
 * @property {Readonly<Record<string, unknown>>} [metadata] - Detached target-specific JSON metadata.
 */

/**
 * @typedef DiscoveredToolchain
 * @property {string} id - Toolchain ID.
 * @property {string} command - Documented canonical command.
 * @property {string} executable - Exact absolute executable path.
 * @property {"override" | "canonical"} source - Resolution route.
 * @property {string} version - First selected-stream version line.
 * @property {string} versionOutput - Complete normalized stdout, or normalized stderr when stdout is empty.
 * @property {readonly string[]} versionArguments - Exact version argument array.
 */

/**
 * @typedef AcceptanceStageResult
 * @property {AcceptanceStage} stage - Completed stage.
 * @property {string} executable - Exact executable used.
 * @property {readonly string[]} arguments - Exact argument array used.
 * @property {string} version - Discovered tool version.
 * @property {string} stdout - Captured standard output.
 * @property {string} stderr - Captured standard error.
 */

/**
 * @typedef AcceptanceResult
 * @property {string} target - Target identity.
 * @property {string} directory - Removed isolated project directory identity.
 * @property {readonly AcceptanceStageResult[]} stages - Ordered completed stages.
 */

/**
 * @typedef TypeReference
 * @property {"TypeReference"} kind - Node discriminator.
 * @property {SemanticTypeName} name - Normalized scalar value type name.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance that survives semantic transforms.
 */

/**
 * @typedef ListType
 * @property {"ListType"} kind - Recursive list-type discriminator.
 * @property {SemanticValueType} elementType - Homogeneous element type.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned outer and argument ranges.
 */

/**
 * @typedef MapType
 * @property {"MapType"} kind - Recursive map-type discriminator.
 * @property {TypeReference} keyType - Exact string key type.
 * @property {SemanticValueType} valueType - Homogeneous value type.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned outer and argument ranges.
 */

/**
 * @typedef OptionalType
 * @property {"OptionalType"} kind - Explicit presence/absence type discriminator.
 * @property {SemanticValueType} valueType - Exact present-value type.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned outer and constituent ranges.
 */

/**
 * @typedef RecordType
 * @property {"RecordType"} kind - Nominal record-type discriminator.
 * @property {string} declarationId - Stable module-local record declaration identity.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned type-name range.
 */

/**
 * @typedef ErrorType
 * @property {"ErrorType"} kind - Nominal unchecked-error type discriminator.
 * @property {string} declarationId - Stable error declaration identity.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned type-name range.
 */

/** @typedef {TypeReference | ListType | MapType | OptionalType | RecordType} SemanticValueType */
/** @typedef {SemanticValueType | ErrorType} SemanticBindingType */

/**
 * @typedef FunctionReturnTypeReference
 * @property {"TypeReference"} kind - Void return discriminator.
 * @property {"void"} name - Normalized non-value function return.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance that survives semantic transforms.
 */

/** @typedef {SemanticValueType | FunctionReturnTypeReference} SemanticFunctionReturnType */

/** @typedef {SemanticTypeName | {kind: "ListType", elementType: SemanticTypeIdentity} | {kind: "MapType", keyType: SemanticTypeIdentity, valueType: SemanticTypeIdentity} | {kind: "OptionalType", valueType: SemanticTypeIdentity} | {kind: "RecordType", declarationId: string}} SemanticTypeIdentity */
/** @typedef {SemanticTypeIdentity | "void"} FunctionReturnTypeIdentity */

/**
 * @typedef ResolvedFunctionSignature
 * @property {"ResolvedFunctionSignature"} kind - Resolution discriminator.
 * @property {string} declarationId - Deterministic module-local declaration identity.
 * @property {SemanticTypeIdentity[]} parameterTypes - Exact required positional parameter types.
 * @property {FunctionReturnTypeIdentity} returnType - Exact resolved return type.
 */

/**
 * @typedef Parameter
 * @property {"Parameter"} kind - Node discriminator.
 * @property {string} name - Parameter name.
 * @property {SemanticValueType} type - Parameter type.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ListLiteral
 * @property {"ListLiteral"} kind - Ordered immutable list literal.
 * @property {Expression[]} elements - Source-ordered, duplicate-preserving elements.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef MapEntry
 * @property {"MapEntry"} kind - Source-ordered map initializer entry.
 * @property {StringLiteral} key - Literal nonnumeric string key.
 * @property {Expression} value - Entry value.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef MapLiteral
 * @property {"MapLiteral"} kind - Immutable map literal; entry order is diagnostic-only.
 * @property {MapEntry[]} entries - Source initializer order.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ListIndexExpression
 * @property {"ListIndexExpression"} kind - Total zero-based list index.
 * @property {Expression} collection - List-valued receiver.
 * @property {Expression} index - Integer index.
 * @property {"proven" | "fail-on-absence"} totality - Admission basis; never optional.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef MapLookupExpression
 * @property {"MapLookupExpression"} kind - Total string-key map lookup.
 * @property {Expression} collection - Map-valued receiver.
 * @property {Expression} key - String key expression.
 * @property {"proven" | "fail-on-absence"} totality - Admission basis; never optional.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef CollectionSizeExpression
 * @property {"CollectionSizeExpression"} kind - Finite collection size.
 * @property {Expression} collection - List- or map-valued receiver.
 * @property {"list" | "map"} [collectionKind] - Validated receiver kind for target spelling.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef IdentifierExpression
 * @property {"IdentifierExpression"} kind - Node discriminator.
 * @property {string} name - Referenced name.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef IntegerLiteral
 * @property {"IntegerLiteral"} kind - Node discriminator.
 * @property {number} value - JavaScript-safe integer value.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef BooleanLiteral
 * @property {"BooleanLiteral"} kind - Node discriminator.
 * @property {boolean} value - Boolean value.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef StringLiteral
 * @property {"StringLiteral"} kind - Node discriminator.
 * @property {string} value - Unicode string value.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef OptionalNone
 * @property {"OptionalNone"} kind - Contextually typed absence value.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef OptionalSome
 * @property {"OptionalSome"} kind - Explicit present optional value.
 * @property {Expression} value - Exact non-optional present value.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef OptionalIsPresent
 * @property {"OptionalIsPresent"} kind - Presence test for one simple identifier.
 * @property {IdentifierExpression} operand - Tested optional binding.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef OptionalUnwrap
 * @property {"OptionalUnwrap"} kind - Guarded unwrap of one simple identifier.
 * @property {IdentifierExpression} operand - Proven-present optional binding.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef UnaryExpression
 * @property {"UnaryExpression"} kind - Node discriminator.
 * @property {SemanticUnaryOperation} operation - Closed semantic operation.
 * @property {Expression} operand - Operand evaluated exactly once.
 * @property {SemanticTypeName} type - Explicit operation result type.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef BinaryExpression
 * @property {"BinaryExpression"} kind - Node discriminator.
 * @property {SemanticBinaryOperation} operation - Closed semantic operation.
 * @property {Expression} left - Left operand.
 * @property {Expression} right - Right operand.
 * @property {SemanticTypeName} type - Explicit operation result type.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef CallExpression
 * @property {"CallExpression"} kind - Node discriminator.
 * @property {string} callee - Function name.
 * @property {Expression[]} arguments - Positional arguments.
 * @property {ResolvedFunctionSignature} [resolution] - Deterministic declaration and signature binding, required after frontend validation.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef RecordConstruction
 * @property {"RecordConstruction"} kind - Nominal record construction.
 * @property {RecordType} record - Resolved record declaration identity.
 * @property {Expression[]} arguments - Complete field-ordered constructor arguments.
 * @property {SourceLocation} location - Complete construction source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned record-name range.
 */

/**
 * @typedef MemberRead
 * @property {"MemberRead"} kind - Nominal immutable record-field read.
 * @property {Expression} receiver - Record-valued receiver.
 * @property {string} field - Stable resolved field identity after frontend validation.
 * @property {SourceLocation} location - Complete member-read source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned member-name range.
 */

/**
 * @typedef ErrorMessageRead
 * @property {"ErrorMessageRead"} kind - The sole portable error member operation.
 * @property {IdentifierExpression} receiver - Catch binding whose immutable message is read.
 * @property {SourceLocation} location - Complete message-read source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned message-member range.
 */

/** @typedef {IdentifierExpression | IntegerLiteral | BooleanLiteral | StringLiteral | OptionalNone | OptionalSome | OptionalIsPresent | OptionalUnwrap | ListLiteral | MapLiteral | ListIndexExpression | MapLookupExpression | CollectionSizeExpression | UnaryExpression | BinaryExpression | CallExpression | RecordConstruction | MemberRead | ErrorMessageRead} Expression */

/**
 * @typedef LocalDeclaration
 * @property {"LocalDeclaration"} kind - Node discriminator.
 * @property {string} name - Declared local name.
 * @property {SemanticValueType} type - Explicit local type.
 * @property {boolean} mutable - Whether later assignment is allowed.
 * @property {Expression} initializer - Required initializer expression.
 * @property {SourceLocation} location - Declaration source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef AssignmentStatement
 * @property {"AssignmentStatement"} kind - Node discriminator.
 * @property {IdentifierExpression} target - Simple local assignment target.
 * @property {Expression} expression - Assigned expression.
 * @property {SourceLocation} location - Assignment source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ReturnStatement
 * @property {"ReturnStatement"} kind - Node discriminator.
 * @property {Expression} [expression] - Returned expression; absent exactly for a bare void return.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ExpressionStatement
 * @property {"ExpressionStatement"} kind - Node discriminator.
 * @property {CallExpression} expression - A direct call whose resolved return type is void.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef IfStatement
 * @property {"IfStatement"} kind - Node discriminator.
 * @property {Expression} condition - Branch condition.
 * @property {Block} consequent - True branch.
 * @property {Block} [alternate] - False branch, absent when execution falls through.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ValueBinding
 * @property {"ValueBinding"} kind - Iteration-binding discriminator.
 * @property {string} name - Body-local binding name.
 * @property {SemanticValueType} type - Exact list element type.
 * @property {false} mutable - Iteration bindings are always immutable.
 * @property {SourceLocation} location - Binding source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ForEachStatement
 * @property {"ForEachStatement"} kind - Ordered list-iteration discriminator.
 * @property {Expression} list - List expression evaluated exactly once before traversal.
 * @property {ValueBinding} valueBinding - Immutable binding scoped to the body.
 * @property {Block} body - Loop body.
 * @property {SourceLocation} location - Complete loop source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef BreakStatement
 * @property {"BreakStatement"} kind - Nearest-loop break discriminator.
 * @property {SourceLocation} location - Keyword source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ContinueStatement
 * @property {"ContinueStatement"} kind - Nearest-loop continue discriminator.
 * @property {SourceLocation} location - Keyword source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef ErrorConstruction
 * @property {"ErrorConstruction"} kind - Construction of one declared unchecked error.
 * @property {ErrorType} error - Exact nominal error type.
 * @property {Expression} message - Sole immutable string payload.
 * @property {SourceLocation} location - Complete construction source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned type and message ranges.
 */

/**
 * @typedef RaiseStatement
 * @property {"RaiseStatement"} kind - Abrupt unchecked-error propagation.
 * @property {ErrorConstruction} error - Exact constructed semantic error.
 * @property {SourceLocation} location - Complete raise source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned raise range.
 */

/**
 * @typedef CatchBinding
 * @property {"CatchBinding"} kind - Exact-handler binding discriminator.
 * @property {string} name - Handler-local binding name.
 * @property {ErrorType} type - Exact caught nominal error type.
 * @property {false} mutable - Catch bindings are immutable.
 * @property {SourceLocation} location - Binding source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned binding range.
 */

/**
 * @typedef TryStatement
 * @property {"TryStatement"} kind - One body and one exact typed handler.
 * @property {Block} body - Protected body.
 * @property {ErrorType} catchType - Exact caught nominal error type.
 * @property {CatchBinding} catchBinding - Immutable handler-local binding.
 * @property {Block} catchBody - Handler body.
 * @property {SourceLocation} location - Complete try/handler source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned try/catch ranges.
 */

/** @typedef {LocalDeclaration | AssignmentStatement} LocalStatement */
/** @typedef {LocalStatement | ExpressionStatement | IfStatement | ForEachStatement | BreakStatement | ContinueStatement | ReturnStatement | PrintStatement | RaiseStatement | TryStatement} Statement */

/**
 * @typedef Block
 * @property {"Block"} kind - Node discriminator.
 * @property {Statement[]} statements - Ordered statements in one lexical scope.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef FunctionDeclaration
 * @property {"FunctionDeclaration"} kind - Node discriminator.
 * @property {string} [id] - Deterministic module-local declaration identity, required after frontend validation.
 * @property {string} name - Function name.
 * @property {Parameter[]} parameters - Function parameters.
 * @property {SemanticFunctionReturnType} returnType - Return type.
 * @property {Block} body - Function body.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef RecordField
 * @property {"RecordField"} kind - Closed record-field discriminator.
 * @property {string} [id] - Stable module-local field identity, required after frontend validation.
 * @property {string} name - Field name.
 * @property {SemanticValueType} type - Exact field type.
 * @property {SourceLocation} location - Field declaration source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned name/type ranges.
 */

/**
 * @typedef RecordDeclaration
 * @property {"RecordDeclaration"} kind - Nominal closed immutable record declaration.
 * @property {string} [id] - Stable module-local declaration identity, required after frontend validation.
 * @property {string} name - Record name.
 * @property {RecordField[]} fields - Ordered unique visible fields.
 * @property {SourceLocation} location - Complete declaration source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned declaration-name range.
 */

/**
 * @typedef ErrorDeclaration
 * @property {"ErrorDeclaration"} kind - Nominal unchecked error with one immutable string message.
 * @property {string} [id] - Stable module-local declaration identity, required after frontend validation.
 * @property {string} name - Error type name.
 * @property {SourceLocation} location - Complete declaration source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned declaration-name range.
 */

/**
 * @typedef PrintStatement
 * @property {"PrintStatement"} kind - Node discriminator.
 * @property {Expression} expression - Printed expression.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef EntryPoint
 * @property {"EntryPoint"} kind - Node discriminator.
 * @property {Block} body - Entry-point body.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef SemanticModule
 * @property {"Module"} kind - Node discriminator.
 * @property {RecordDeclaration[]} [records] - Top-level nominal record declarations in source order; omitted when empty.
 * @property {ErrorDeclaration[]} [errors] - Top-level nominal unchecked error declarations in source order; omitted when empty.
 * @property {FunctionDeclaration[]} functions - Top-level functions.
 * @property {EntryPoint} entryPoint - Executable entry point.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 * @property {SemanticProvenance} [provenance] - Parser-authored source and identity index; optional for legacy caller-authored modules.
 */

/**
 * @typedef SemanticImport
 * @property {"Import"} kind - Node discriminator.
 * @property {string} moduleId - Stable imported semantic module identity.
 * @property {string} importedName - Exported declaration name in the source module.
 * @property {string} localName - Binding name visible in the importing module.
 * @property {SemanticDeclarationKind} symbolKind - Imported declaration namespace.
 * @property {string} declarationId - Stable resolved declaration identity.
 * @property {boolean} typeOnly - Whether source syntax admitted only type-position use.
 * @property {SourceLocation} location - Complete import declaration/specifier location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned import ranges.
 */

/**
 * @typedef SemanticExport
 * @property {"Export"} kind - Node discriminator.
 * @property {string} exportedName - Name visible to importing modules.
 * @property {SemanticDeclarationKind} symbolKind - Exported declaration namespace.
 * @property {string} declarationId - Stable exported declaration identity.
 * @property {SourceLocation} location - Complete export declaration/specifier location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Parser-owned export ranges.
 */

/**
 * @typedef SemanticProgramModule
 * @property {"Module"} kind - Node discriminator.
 * @property {string} id - Stable caller-supplied logical module identity.
 * @property {string} sourceFilename - Explicit source filename; never an implicit read request.
 * @property {RecordDeclaration[]} [records] - Top-level nominal record declarations.
 * @property {ErrorDeclaration[]} [errors] - Top-level nominal unchecked error declarations.
 * @property {FunctionDeclaration[]} functions - Top-level functions.
 * @property {SemanticImport[]} imports - Resolved imports in source order.
 * @property {SemanticExport[]} exports - Resolved exports in source order.
 * @property {EntryPoint} [entryPoint] - Sole executable entry point, present only on the selected module.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 * @property {SemanticProvenance} [provenance] - Parser-authored source and identity index.
 */

/**
 * @typedef SemanticProgram
 * @property {"Program"} kind - Node discriminator.
 * @property {SemanticProgramModule[]} modules - Dependency-first deterministic module order.
 * @property {string} entryModule - Stable identity of the sole entry module.
 * @property {RegisteredSource[]} sources - Caller-order complete source registry.
 */

/** @typedef {SemanticModule | SemanticProgramModule | SemanticImport | SemanticExport | RecordDeclaration | ErrorDeclaration | RecordField | FunctionDeclaration | Parameter | ValueBinding | CatchBinding | Block | Statement | EntryPoint | Expression | ErrorConstruction | ErrorType | MapEntry | SemanticValueType | FunctionReturnTypeReference} SemanticNode */
/** @typedef {SemanticNode} SemanticNodeWithoutLocations */

export {}
