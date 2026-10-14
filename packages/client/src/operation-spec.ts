// SPDX-License-Identifier: MIT
// Shape of one entry in the generated operation table (src/generated/operations.ts).

export type ParamLocation = "path" | "query" | "header" | "cookie";

export type OperationParamSpec = {
  readonly name: string;
  readonly in: ParamLocation;
  readonly required: boolean;
};

export type OperationSpec = {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
  /** Alternatives (OR) of security scheme sets (AND); empty = no auth. */
  readonly security: readonly (readonly string[])[];
  readonly params: readonly OperationParamSpec[];
  readonly body: { readonly contentType: string; readonly required: boolean } | null;
  /** How a 2xx body is decoded. */
  readonly response: "json" | "text" | "binary";
};
