// ── Validation report shape ──────────────────────────────────────────

export interface ValidationReport {
  valid: boolean;
  /** Dot-path + message per problem, e.g. `$.units[0].goal: expected a non-empty string`. */
  errors: string[];
}
