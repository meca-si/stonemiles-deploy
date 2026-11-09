// Standalone server shim for @hatch/space-sdk (STONEMILES re-platform, Phase 1).
//
// Compact re-implementation of the server-side surface of the Muse space
// SDK, mirroring the semantics of the real SDK's server-contract module
// (defineAction / privileged contracts / privileged executor) closely enough
// for the app's server bundle to run under a plain Bun host. Only the surface
// the app actually imports is implemented, plus the brand/recognition helpers
// the host dispatch needs.
//
// Imported by server code as:
//   import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
//   import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

import { z } from "zod";
export { z };

// ---------------------------------------------------------------------------
// Privileged contracts
// ---------------------------------------------------------------------------

export const PRIVILEGED_CONTRACT_BRAND = "@hatch/space-sdk/privileged-contract/v1";
export const PRIVILEGED_HANDLERS_FORMAT = "hatch-space-privileged-handlers-v1";

export function definePrivilegedContracts(specs) {
  const contracts = {};
  for (const [name, spec] of Object.entries(specs)) {
    contracts[name] = {
      __brand: PRIVILEGED_CONTRACT_BRAND,
      name,
      request: spec.request,
      response: spec.response,
      ...(spec.capabilities !== undefined ? { capabilities: spec.capabilities } : {}),
      ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
    };
  }
  return contracts;
}

export function definePrivilegedHandlers(contracts, handlers) {
  const entries = [];
  for (const [key, handler] of Object.entries(handlers)) {
    if (handler === undefined) continue;
    const contract = contracts[key];
    if (!isPrivilegedContract(contract)) {
      throw new Error(`privileged handler '${key}' does not have a contract descriptor`);
    }
    entries.push({ contract, handler });
  }
  return { format: PRIVILEGED_HANDLERS_FORMAT, entries };
}

export function isPrivilegedContract(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "__brand" in value &&
    value.__brand === PRIVILEGED_CONTRACT_BRAND
  );
}

export function isPrivilegedHandlers(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "format" in value &&
    value.format === PRIVILEGED_HANDLERS_FORMAT &&
    Array.isArray(value.entries)
  );
}

/**
 * Build the per-action privileged executor. The executor is bound to the
 * contracts the action DECLARED (its `privileged` list): calling with an
 * undeclared contract name throws, args are parsed with the contract's
 * request schema, the transport's result is parsed with its response schema.
 * Mirrors the real SDK's createPrivilegedExecutor.
 */
export function createPrivilegedExecutor(declared, transport) {
  const declaredNames = new Set((declared ?? []).map((contract) => contract.name));
  return {
    async executePrivileged(contract, args) {
      if (!isPrivilegedContract(contract)) {
        throw new Error("ctx.executePrivileged requires a privileged contract descriptor");
      }
      if (!declaredNames.has(contract.name)) {
        throw new Error(`ctx.executePrivileged(${contract.name}) was not declared by this action`);
      }
      const parsedArgs = contract.request.parse(args);
      const result = await transport(contract, parsedArgs);
      return contract.response.parse(result);
    },
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTION_BRAND = "@hatch/space-sdk/action/v1";
const LEGACY_ACTION_BRAND = Symbol.for("@hatch/space-sdk/action");
const ACTION_DESCRIPTION_MAX_CHARS = 300;

export function actionDescription(definition) {
  const description = definition.description
    ?.replace(/[\s\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return description
    ? [...description].slice(0, ACTION_DESCRIPTION_MAX_CHARS).join("")
    : undefined;
}

export function defineAction(spec) {
  return {
    __brand: ACTION_BRAND,
    request: spec.request,
    response: spec.response,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.privileged !== undefined ? { privileged: spec.privileged } : {}),
    handler: spec.handler,
  };
}

export function isAction(value) {
  if (typeof value !== "object" || value === null) return false;
  if ("__brand" in value && value.__brand === ACTION_BRAND) return true;
  return value.kind === "action" && value[LEGACY_ACTION_BRAND] === true;
}

// ---------------------------------------------------------------------------
// Inference errors
// ---------------------------------------------------------------------------

export const INFERENCE_SCHEMA_ERROR_BRAND = "@hatch/space-sdk/InferenceSchemaError/v1";

export class InferenceSchemaError extends Error {
  __brand = INFERENCE_SCHEMA_ERROR_BRAND;
  issues;
  constructor(issues) {
    super(
      `Inference output failed schema validation (${issues.length} issue${issues.length === 1 ? "" : "s"})`,
    );
    this.name = "InferenceSchemaError";
    this.issues = issues;
  }
  static is(value) {
    if (value instanceof InferenceSchemaError) return true;
    return (
      typeof value === "object" &&
      value !== null &&
      "__brand" in value &&
      value.__brand === INFERENCE_SCHEMA_ERROR_BRAND &&
      "issues" in value &&
      Array.isArray(value.issues)
    );
  }
}
