// The KODA tested catalogue (`src/providers/koda-tested.json`): models scored by the bench, with
// residency, price and the hash of the signed report each score came from. Models that have not
// been benchmarked yet are listed as `pending` with residency and price only. Model and provider
// ids are configuration data, never product copy.
import CATALOGUE_JSON from "../providers/koda-tested.json" with { type: "json" };
import { getModelPrice, getProvider } from "../providers/registry.js";
import { BENCH_AXES, type BenchAxis, type BenchReport, type ModelPrice } from "./types.js";

export const RESIDENCIES = ["jp", "eu", "us", "cn", "sg", "local", "unknown"] as const;
export type Residency = (typeof RESIDENCIES)[number];

export type CatalogueEntry = {
  provider: string;
  model: string;
  status: "tested" | "pending";
  residency: { region: Residency; source: string };
  scores: Record<BenchAxis, number | null> | null;
  overall: number | null;
  /** Share of the suite that ran (1 = every task). */
  coverage: number | null;
  subset: "full" | "quick" | null;
  costPerResidentHour: { amount: number; currency: string } | null;
  price: ModelPrice | null;
  lastBenchmarked: string | null;
  reportHash: string | null;
  notes?: string;
};

export type Catalogue = {
  version: 1;
  suite: string;
  updatedAt: string;
  methodology: string;
  models: CatalogueEntry[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCatalogue(doc: unknown): string[] {
  const issues: string[] = [];
  const cat = doc as Partial<Catalogue> | null;
  if (!cat || typeof cat !== "object" || cat.version !== 1 || !Array.isArray(cat.models)) {
    return ["catalogue: version 1 with a models array is required"];
  }
  const seen = new Set<string>();
  for (const [i, m] of cat.models.entries()) {
    const where = `models[${i}] ${m?.provider ?? "?"}/${m?.model ?? "?"}`;
    if (!m?.provider || !m?.model) {
      issues.push(`${where}: provider and model are required`);
      continue;
    }
    const key = `${m.provider}/${m.model}`;
    if (seen.has(key)) {
      issues.push(`${where}: duplicate`);
    }
    seen.add(key);
    if (!getProvider(m.provider)) {
      issues.push(`${where}: provider is not in the registry`);
    }
    if (!RESIDENCIES.includes(m.residency?.region)) {
      issues.push(`${where}: residency.region must be one of ${RESIDENCIES.join(", ")}`);
    }
    if (!m.residency?.source) {
      issues.push(`${where}: residency.source is required`);
    }
    if (m.status === "tested") {
      if (!m.scores || typeof m.overall !== "number") {
        issues.push(`${where}: a tested model needs scores and overall`);
      }
      if (!m.reportHash || !/^[0-9a-f]{64}$/.test(m.reportHash)) {
        issues.push(`${where}: a tested model needs the sha256 of its report`);
      }
      if (!m.lastBenchmarked || !ISO_DATE.test(m.lastBenchmarked)) {
        issues.push(`${where}: lastBenchmarked must be YYYY-MM-DD`);
      }
    } else if (m.status !== "pending") {
      issues.push(`${where}: status must be tested or pending`);
    }
    for (const axis of BENCH_AXES) {
      const v = m.scores?.[axis];
      if (v !== undefined && v !== null && (typeof v !== "number" || v < 0 || v > 100)) {
        issues.push(`${where}: scores.${axis} must be 0..100 or null`);
      }
    }
  }
  return issues;
}

export function loadCatalogue(doc: unknown = CATALOGUE_JSON): Catalogue {
  return structuredClone(doc) as Catalogue;
}

/** Residency of a provider from the registry's region note (the source is recorded). */
export function residencyFromRegistry(providerId: string): { region: Residency; source: string } {
  const entry = getProvider(providerId);
  const note = entry?.regionNote ?? "";
  const lower = note.toLowerCase();
  const region: Residency = lower.startsWith("local")
    ? "local"
    : lower.includes("japan")
      ? "jp"
      : lower.includes("european union")
        ? "eu"
        : lower.includes("china")
          ? "cn"
          : lower.includes("singapore")
            ? "sg"
            : lower.includes("us-hosted")
              ? "us"
              : "unknown";
  return { region, source: `provider registry: ${note || "no region note"}` };
}

export type CatalogueFilter = {
  residency?: Residency;
  minScore?: number;
  status?: CatalogueEntry["status"];
};

export function filterCatalogue(cat: Catalogue, filter: CatalogueFilter): CatalogueEntry[] {
  return cat.models
    .filter((m) => !filter.residency || m.residency.region === filter.residency)
    .filter((m) => !filter.status || m.status === filter.status)
    .filter((m) => filter.minScore === undefined || (m.overall ?? -1) >= filter.minScore)
    .toSorted(
      (a, b) =>
        (b.overall ?? -1) - (a.overall ?? -1) ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    );
}

/**
 * Merge a signed report: each complete-enough model becomes (or replaces) a tested entry. A model
 * that ran nothing is left as it was.
 */
export function mergeReport(cat: Catalogue, report: BenchReport): Catalogue {
  const next = loadCatalogue(cat);
  const date = report.createdAt.slice(0, 10);
  for (const m of report.models) {
    if (m.overall === null || m.coverage === 0) {
      continue;
    }
    const scores = Object.fromEntries(
      BENCH_AXES.map((a) => [a, m.axes[a]?.score ?? null]),
    ) as Record<BenchAxis, number | null>;
    const price = getModelPrice(m.provider, m.model);
    const existing = next.models.find((e) => e.provider === m.provider && e.model === m.model);
    const entry: CatalogueEntry = {
      provider: m.provider,
      model: m.model,
      status: "tested",
      residency: existing?.residency ?? residencyFromRegistry(m.provider),
      scores,
      overall: m.overall,
      coverage: m.coverage,
      subset: m.subset,
      costPerResidentHour:
        m.costPerResidentHour !== null && price
          ? { amount: m.costPerResidentHour, currency: price.currency }
          : null,
      price,
      lastBenchmarked: date,
      reportHash: report.hash,
      ...(existing?.notes ? { notes: existing.notes } : {}),
    };
    if (existing) {
      next.models[next.models.indexOf(existing)] = entry;
    } else {
      next.models.push(entry);
    }
  }
  next.updatedAt = date;
  next.suite = report.suite.version;
  return next;
}

export type CataloguePick = { entry: CatalogueEntry; reason: string };

/**
 * The best tested model the user can run: its provider is usable (`available`), its residency
 * matches the preference when one is given, highest overall first. Quick-subset results rank
 * after full ones of the same residency only by their score; coverage is shown, not hidden.
 */
export function pickBestModel(params: {
  catalogue?: Catalogue;
  available: (providerId: string, modelId: string) => boolean;
  residency?: Residency;
  minScore?: number;
}): CataloguePick | null {
  const cat = params.catalogue ?? loadCatalogue();
  const candidates = filterCatalogue(cat, {
    status: "tested",
    residency: params.residency,
    minScore: params.minScore,
  }).filter((m) => params.available(m.provider, m.model));
  const best = candidates[0];
  if (!best) {
    return null;
  }
  return {
    entry: best,
    reason: `highest overall score (${best.overall}) among tested models you can run${
      params.residency ? ` with residency ${params.residency}` : ""
    }`,
  };
}
