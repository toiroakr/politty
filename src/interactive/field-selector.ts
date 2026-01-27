import { z } from "zod";
import { getArgMeta } from "../core/arg-registry.js";
import type { ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { FieldType, InteractiveMode, PromptFieldInfo, PromptType } from "../types.js";

// Internal type for accessing zod v4 internals
interface ZodV4Def {
  type?: string;
  innerType?: z.ZodType;
  values?: readonly string[];
  options?: z.ZodType[];
}

type ZodSchemaWithDef = z.ZodType & { def?: ZodV4Def; _def?: ZodV4Def; type?: string };

/**
 * Get the type name from a zod schema (v4 compatible)
 */
function getTypeName(schema: z.ZodType): string | undefined {
  const s = schema as ZodSchemaWithDef;
  return s.def?.type ?? s._def?.type ?? s.type;
}

/**
 * Unwrap optional, nullable, default wrappers to get inner schema
 */
function unwrapSchema(schema: z.ZodType): z.ZodType {
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  if (typeName === "optional" || typeName === "nullable" || typeName === "default") {
    const innerSchema = def?.innerType;
    if (innerSchema) {
      return unwrapSchema(innerSchema);
    }
  }

  return schema;
}

/**
 * Check if schema is enum-like (z.enum() or z.literal union)
 */
function isEnumLike(schema: z.ZodType): boolean {
  const inner = unwrapSchema(schema);
  const typeName = getTypeName(inner);

  if (typeName === "enum") {
    return true;
  }

  // Check for literal union (z.union([z.literal("a"), z.literal("b")]))
  if (typeName === "union") {
    const s = inner as ZodSchemaWithDef;
    const def = s.def ?? s._def;
    const options = def?.options ?? [];
    return options.every((opt) => getTypeName(opt) === "literal");
  }

  return false;
}

/**
 * Check if schema is an array schema
 */
function isArraySchema(schema: z.ZodType): boolean {
  const inner = unwrapSchema(schema);
  return getTypeName(inner) === "array";
}

/**
 * Extract enum choices from a schema
 */
function extractEnumChoices(schema: z.ZodType): readonly string[] | undefined {
  let inner = unwrapSchema(schema);

  // If it's an array, get the element type
  if (isArraySchema(schema)) {
    const s = inner as ZodSchemaWithDef;
    const def = s.def ?? s._def;
    const elementType = def?.innerType;
    if (elementType) {
      inner = unwrapSchema(elementType);
    }
  }

  const typeName = getTypeName(inner);

  if (typeName === "enum") {
    const s = inner as ZodSchemaWithDef;
    const def = s.def ?? s._def;
    return def?.values;
  }

  // Handle literal union
  if (typeName === "union") {
    const s = inner as ZodSchemaWithDef;
    const def = s.def ?? s._def;
    const options = def?.options ?? [];
    const literals: string[] = [];

    for (const opt of options) {
      if (getTypeName(opt) === "literal") {
        const optDef = (opt as ZodSchemaWithDef).def ?? (opt as ZodSchemaWithDef)._def;
        const values = optDef?.values;
        if (values && values.length > 0) {
          literals.push(String(values[0]));
        }
      }
    }

    return literals.length > 0 ? literals : undefined;
  }

  return undefined;
}

/**
 * Determine the prompt type for a field based on its schema and metadata
 */
export function determinePromptType(field: PromptFieldInfo): PromptType {
  // Explicit settings take priority
  if (field.secret) return "password";
  if (field.editor) return "editor";

  // Determine by schema type
  if (field.type === "boolean") return "confirm";

  if (isEnumLike(field.schema)) {
    // If it's an array of enums, use checkbox for multiple selection
    if (isArraySchema(field.schema)) {
      return "checkbox";
    }
    return "select";
  }

  return "input";
}

/**
 * Convert ResolvedFieldMeta to PromptFieldInfo
 */
function toPromptFieldInfo(
  field: ResolvedFieldMeta,
  currentArgs: Record<string, unknown>,
): PromptFieldInfo {
  const meta = getArgMeta(field.schema);
  const choices = extractEnumChoices(field.schema);

  const result: PromptFieldInfo = {
    name: field.name,
    cliName: field.cliName,
    required: field.required,
    defaultValue: field.defaultValue,
    type: field.type as FieldType,
    currentValue: currentArgs[field.name],
    schema: field.schema,
  };

  // Only add optional properties if they have values
  if (field.description !== undefined) {
    result.description = field.description;
  }
  if (meta?.promptMessage !== undefined) {
    result.promptMessage = meta.promptMessage;
  }
  if (meta?.secret !== undefined) {
    result.secret = meta.secret;
  }
  if (meta?.editor !== undefined) {
    result.editor = meta.editor;
  }
  if (choices !== undefined) {
    result.choices = choices;
  }

  return result;
}

/**
 * Determine which fields need interactive prompting
 *
 * @param fields - All fields from schema extraction
 * @param currentArgs - Current argument values (from CLI/env)
 * @param mode - Interactive mode setting
 * @returns Array of fields that need prompting
 */
export function determineFieldsToPrompt(
  fields: ResolvedFieldMeta[],
  currentArgs: Record<string, unknown>,
  mode: InteractiveMode,
): PromptFieldInfo[] {
  if (mode === false) {
    return [];
  }

  // Get field-level interactive settings from argRegistry
  const fieldInteractiveSettings = new Map<string, boolean | undefined>();
  for (const field of fields) {
    const meta = getArgMeta(field.schema);
    fieldInteractiveSettings.set(field.name, meta?.interactive);
  }

  switch (mode) {
    case "required": {
      // Only prompt for missing required fields
      return fields
        .filter((field) => {
          const fieldInteractive = fieldInteractiveSettings.get(field.name);
          // Skip if explicitly disabled
          if (fieldInteractive === false) return false;
          // Include if required and not provided
          return field.required && currentArgs[field.name] === undefined;
        })
        .map((field) => toPromptFieldInfo(field, currentArgs));
    }

    case "all": {
      // Check if ANY required field is missing
      const hasMissingRequired = fields.some(
        (field) =>
          field.required &&
          currentArgs[field.name] === undefined &&
          fieldInteractiveSettings.get(field.name) !== false,
      );

      if (!hasMissingRequired) {
        return [];
      }

      // Prompt for ALL fields (except those explicitly disabled)
      return fields
        .filter((field) => fieldInteractiveSettings.get(field.name) !== false)
        .map((field) => toPromptFieldInfo(field, currentArgs));
    }

    case "explicit": {
      // Only prompt for fields with interactive: true
      return fields
        .filter((field) => fieldInteractiveSettings.get(field.name) === true)
        .filter((field) => currentArgs[field.name] === undefined)
        .map((field) => toPromptFieldInfo(field, currentArgs));
    }

    default:
      return [];
  }
}

/**
 * Get custom prompt function for a field if specified in arg()
 */
export function getFieldPromptFunction(
  field: PromptFieldInfo,
): ((field: PromptFieldInfo) => Promise<unknown>) | undefined {
  const meta = getArgMeta(field.schema);
  // Cast is needed because ArgPromptFunction uses 'any' to avoid circular deps
  return meta?.prompt as ((field: PromptFieldInfo) => Promise<unknown>) | undefined;
}
