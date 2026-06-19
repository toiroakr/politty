export interface LongOptionResolution {
  resolvedName: string;
  withoutDashes: string;
  isNegated: boolean;
  isCustomNegation: boolean;
  isSuppressedNegation: boolean;
}

export interface LongOptionLookup {
  aliasMap: Map<string, string>;
  booleanFlags: Set<string>;
  definedNames: Set<string>;
  negationMap: Map<string, string>;
  customNegatedFields: Set<string>;
}

export function resolveLongOption(arg: string, lookup: LongOptionLookup): LongOptionResolution {
  const withoutDashes = arg.slice(2);
  const bareToken = arg.includes("=") ? arg.slice(2, arg.indexOf("=")) : withoutDashes;

  // Phase 1: Custom negation (e.g. --disable-cache → cache=false)
  // Only the bare form (no `=`), since custom negation is a boolean shortcut.
  if (!arg.includes("=")) {
    const negatedField = lookup.negationMap.get(bareToken);
    if (negatedField && lookup.booleanFlags.has(negatedField)) {
      return {
        resolvedName: negatedField,
        withoutDashes,
        isNegated: true,
        isCustomNegation: true,
        isSuppressedNegation: false,
      };
    }
  }

  // Phase 2: Kebab-case default negation --no-<flag>
  if (bareToken.startsWith("no-")) {
    const flagName = bareToken.slice(3);
    // Block mixed form: --no-dryRun (kebab prefix + camelCase)
    if (flagName === flagName.toLowerCase()) {
      const resolvedName = lookup.aliasMap.get(flagName) ?? flagName;
      if (lookup.booleanFlags.has(resolvedName)) {
        // Literal-name disambiguation: "no-dry-run" itself is a defined field
        const asIsResolved = lookup.aliasMap.get(bareToken) ?? bareToken;
        if (!lookup.definedNames.has(asIsResolved)) {
          if (lookup.customNegatedFields.has(resolvedName)) {
            return {
              resolvedName,
              withoutDashes,
              isNegated: false,
              isCustomNegation: false,
              isSuppressedNegation: true,
            };
          }
          return {
            resolvedName,
            withoutDashes,
            isNegated: true,
            isCustomNegation: false,
            isSuppressedNegation: false,
          };
        }
      }
    }
  }

  // Phase 3: CamelCase default negation --noFlag
  if (bareToken.length > 2 && bareToken.startsWith("no") && /[A-Z]/.test(bareToken[2]!)) {
    const camelFlagName = bareToken[2]!.toLowerCase() + bareToken.slice(3);
    const resolvedName = lookup.aliasMap.get(camelFlagName) ?? camelFlagName;
    if (lookup.booleanFlags.has(resolvedName)) {
      const asIsResolved = lookup.aliasMap.get(bareToken) ?? bareToken;
      if (!lookup.definedNames.has(asIsResolved)) {
        if (lookup.customNegatedFields.has(resolvedName)) {
          return {
            resolvedName,
            withoutDashes,
            isNegated: false,
            isCustomNegation: false,
            isSuppressedNegation: true,
          };
        }
        return {
          resolvedName,
          withoutDashes,
          isNegated: true,
          isCustomNegation: false,
          isSuppressedNegation: false,
        };
      }
    }
  }

  // No negation matched
  return {
    resolvedName: lookup.aliasMap.get(bareToken) ?? bareToken,
    withoutDashes,
    isNegated: false,
    isCustomNegation: false,
    isSuppressedNegation: false,
  };
}
