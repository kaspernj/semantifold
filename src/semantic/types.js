// @ts-check

/** @typedef {"php" | "ruby" | "javascript" | "typescript" | "java"} SemanticLanguage */
/** @typedef {"integer" | "boolean" | "string"} SemanticTypeName */
/** @typedef {"function" | "parameter" | "local"} SemanticSymbolKind */
/** @typedef {"declaration" | "read" | "write" | "call"} SemanticSymbolRole */

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
 * @property {SemanticLanguage} language - Output language.
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
 * @typedef TypeReference
 * @property {"TypeReference"} kind - Node discriminator.
 * @property {SemanticTypeName} name - Normalized type name.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance that survives semantic transforms.
 */

/**
 * @typedef Parameter
 * @property {"Parameter"} kind - Node discriminator.
 * @property {string} name - Parameter name.
 * @property {TypeReference} type - Parameter type.
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
 * @typedef BinaryExpression
 * @property {"BinaryExpression"} kind - Node discriminator.
 * @property {">" | "-" | "+"} operator - Supported binary operator.
 * @property {Expression} left - Left operand.
 * @property {Expression} right - Right operand.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef CallExpression
 * @property {"CallExpression"} kind - Node discriminator.
 * @property {string} callee - Function name.
 * @property {Expression[]} arguments - Positional arguments.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/** @typedef {IdentifierExpression | IntegerLiteral | BooleanLiteral | StringLiteral | BinaryExpression | CallExpression} Expression */

/**
 * @typedef LocalDeclaration
 * @property {"LocalDeclaration"} kind - Node discriminator.
 * @property {string} name - Declared local name.
 * @property {TypeReference} type - Explicit local type.
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
 * @property {Expression} expression - Returned expression.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/**
 * @typedef IfStatement
 * @property {"IfStatement"} kind - Node discriminator.
 * @property {Expression} condition - Branch condition.
 * @property {(LocalDeclaration | AssignmentStatement | ReturnStatement)[]} consequent - True branch.
 * @property {(LocalDeclaration | AssignmentStatement | ReturnStatement)[]} alternate - False branch.
 * @property {SourceLocation} location - Source location.
 * @property {SemanticNodeSourceProvenance} [sourceProvenance] - Node-associated provenance.
 */

/** @typedef {LocalDeclaration | AssignmentStatement} LocalStatement */
/** @typedef {LocalStatement | IfStatement | ReturnStatement} FunctionStatement */

/**
 * @typedef FunctionDeclaration
 * @property {"FunctionDeclaration"} kind - Node discriminator.
 * @property {string} name - Function name.
 * @property {Parameter[]} parameters - Function parameters.
 * @property {TypeReference} returnType - Return type.
 * @property {FunctionStatement[]} body - Function body.
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
 * @property {(LocalStatement | PrintStatement)[]} body - Entry-point statements.
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

/** @typedef {SemanticModule | FunctionDeclaration | Parameter | FunctionStatement | PrintStatement | EntryPoint | Expression | TypeReference} SemanticNode */
/** @typedef {SemanticNode} SemanticNodeWithoutLocations */

export {}
