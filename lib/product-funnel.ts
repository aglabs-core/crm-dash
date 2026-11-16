/** Contrato fechado compartilhado App → CRM → Órbita. Sem identidades ou rótulos livres. */
export type ProductFunnel = {
  version: 1; kind: "acquisition_sessions" | "trip_creation_users" | "credit_journey_users";
  from: string; to: string; unit: "sessions" | "users"; ordered: boolean;
  series: { key: "all" | "manual" | "ai"; values: (number | null)[] }[];
  sources?: { key: string; values: number[] }[];
};
const definitions = {
  mecard: { kind: "acquisition_sessions", unit: "sessions", ordered: true, size: 4, keys: ["all"] },
  viajeki: { kind: "trip_creation_users", unit: "users", ordered: true, size: 3, keys: ["all", "manual", "ai"] },
  "aglabs-app": { kind: "credit_journey_users", unit: "users", ordered: false, size: 4, keys: ["all"] },
} as const;
const sources = new Set(["direct", "instagram", "facebook", "linkedin", "google", "youtube", "mecard_card", "other"]);
function values(raw: unknown, size: number, ordered: boolean, nullable: boolean): (number | null)[] {
  if (!Array.isArray(raw) || raw.length !== size) throw new Error("Invalid funnel stages");
  return raw.map((value, index) => {
    if (value === null && nullable) return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || (ordered && index > 0 && raw[index - 1] !== null && value > raw[index - 1])) throw new Error("Invalid funnel count");
    return value;
  });
}
export function projectProductFunnel(raw: unknown, product: string, generatedAt: string): ProductFunnel {
  const d = definitions[product as keyof typeof definitions];
  if (!d || !raw || typeof raw !== "object") throw new Error("Invalid funnel product");
  const v = raw as Record<string, unknown>;
  const from = typeof v.from === "string" ? Date.parse(v.from) : NaN;
  const to = typeof v.to === "string" ? Date.parse(v.to) : NaN;
  const at = Date.parse(generatedAt);
  if (v.version !== 1 || v.kind !== d.kind || v.unit !== d.unit || v.ordered !== d.ordered || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(at) || from >= to || to - from > 90 * 86400000 || to > at + (product === "mecard" ? 86400000 : 0)) throw new Error("Invalid funnel window");
  if (!Array.isArray(v.series) || v.series.length !== d.keys.length) throw new Error("Invalid funnel series");
  const series = d.keys.map(key => {
    const rows = (v.series as Record<string, unknown>[]).filter(row => row?.key === key);
    if (rows.length !== 1) throw new Error("Invalid funnel series");
    return { key, values: values(rows[0].values, d.size, d.ordered, product === "aglabs-app") };
  });
  let projectedSources: ProductFunnel["sources"];
  if (product === "mecard" && v.sources !== undefined) {
    if (!Array.isArray(v.sources) || v.sources.length > sources.size) throw new Error("Invalid funnel sources");
    const seen = new Set<string>();
    projectedSources = v.sources.map(row => {
      if (!row || !sources.has(row.key) || seen.has(row.key)) throw new Error("Invalid funnel source");
      seen.add(row.key);
      return { key: row.key, values: values(row.values, d.size, true, false) as number[] };
    });
    if (series[0].values.some((total, i) => projectedSources!.reduce((sum, row) => sum + row.values[i], 0) !== total)) throw new Error("Inconsistent funnel sources");
  }
  return { version: 1, kind: d.kind, unit: d.unit, ordered: d.ordered, from: new Date(from).toISOString(), to: new Date(to).toISOString(), series, ...(projectedSources ? { sources: projectedSources } : {}) };
}
