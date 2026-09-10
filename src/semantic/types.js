// @ts-check

/** @typedef {"php" | "ruby" | "javascript" | "typescript" | "java" | "kotlin" | "python" | "csharp" | "go" | "c" | "cpp" | "rust" | "swift"} SemanticLanguage */
/** @typedef {SemanticLanguage} TextBackendLanguage */
/** @typedef {TextBackendLanguage | "wasm"} BackendLanguage */
/** @typedef {SemanticLanguage | "html"} GeneratedTextLanguage */
/** @typedef {"integer" | "boolean" | "string"} SemanticTypeName */
/** @typedef {SemanticTypeName | "void"} FunctionReturnTypeName */
/** @typedef {"IntegerNegate" | "BooleanNot"} SemanticUnaryOperation */
/** @typedef {"IntegerAdd" | "IntegerSubtract" | "IntegerMultiply" | "BooleanAnd" | "BooleanOr" | "IntegerEqual" | "IntegerNotEqual" | "BooleanEqual" | "BooleanNotEqual" | "StringEqual" | "StringNotEqual" | "IntegerLessThan" | "IntegerLessThanOrEqual" | "IntegerGreaterThan" | "IntegerGreaterThanOrEqual" | "StringConcat"} SemanticBinaryOperation */
/** @typedef {"function" | "parameter" | "local"} SemanticSymbolKind */
/** @typedef {"declaration" | "read" | "write" | "call"} SemanticSymbolRole */
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
 * @property {string} [semanticDeclarationId] - Function declaration identity when kind is function.
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

/** @typedef {TypeReference | ListType | MapType} SemanticValueType */

/**
 * @typedef FunctionReturnTypeReference
 * @property {"TypeReference"} kind - Void return discriminator.
 * @property {"void"} name - Normalized non-value function return.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance that survives semantic transforms.
 */

/** @typedef {SemanticValueType | FunctionReturnTypeReference} SemanticFunctionReturnType */

/** @typedef {SemanticTypeName | {kind: "ListType", elementType: SemanticTypeIdentity} | {kind: "MapType", keyType: SemanticTypeIdentity, valueType: SemanticTypeIdentity}} SemanticTypeIdentity */
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

/** @typedef {IdentifierExpression | IntegerLiteral | BooleanLiteral | StringLiteral | ListLiteral | MapLiteral | ListIndexExpression | MapLookupExpression | CollectionSizeExpression | UnaryExpression | BinaryExpression | CallExpression} Expression */

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

/** @typedef {LocalDeclaration | AssignmentStatement} LocalStatement */
/** @typedef {LocalStatement | ExpressionStatement | IfStatement | ReturnStatement | PrintStatement} Statement */

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
 * @property {FunctionDeclaration[]} functions - Top-level functions.
 * @property {EntryPoint} entryPoint - Executable entry point.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 * @property {SemanticProvenance} [provenance] - Parser-authored source and identity index; optional for legacy caller-authored modules.
 */

/** @typedef {SemanticModule | FunctionDeclaration | Parameter | Block | Statement | EntryPoint | Expression | MapEntry | SemanticValueType | FunctionReturnTypeReference} SemanticNode */
/** @typedef {SemanticNode} SemanticNodeWithoutLocations */

export {}
