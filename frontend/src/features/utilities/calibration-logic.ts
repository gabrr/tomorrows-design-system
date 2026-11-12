export type Measurement = {
  node_id: string;
  source: string;
  measured_at?: string;
  capacity_rps?: number;
  samples_ms: number[];
};
export type Report = {
  node_id: string;
  source: string;
  measured_at?: string;
  sample_count: number;
  training_count: number;
  holdout_count: number;
  service_mean_ms: number;
  holdout_mean_absolute_error_ms: number;
};
export function checkCalibration(
  reports: Report[],
  measurements: Measurement[],
) {
  if (
    !Array.isArray(reports) ||
    reports.length !== measurements.length ||
    new Set(reports.map((r) => r.node_id)).size !== reports.length
  )
    throw new Error("Calibration report does not match submitted targets.");
  for (const report of reports) {
    const input = measurements.find((m) => m.node_id === report.node_id);
    if (!input || report.source !== input.source)
      throw new Error(
        "Calibration report contains an unknown target or changed source.",
      );
    for (const key of [
      "service_mean_ms",
      "holdout_mean_absolute_error_ms",
      "sample_count",
      "training_count",
      "holdout_count",
    ] as const)
      if (
        typeof report[key] !== "number" ||
        !Number.isFinite(report[key]) ||
        report[key] < 0
      )
        throw new Error("Calibration report has invalid " + key);
    if (
      !Number.isInteger(report.sample_count) ||
      !Number.isInteger(report.training_count) ||
      !Number.isInteger(report.holdout_count) ||
      report.sample_count !== input.samples_ms.length ||
      report.training_count + report.holdout_count !== report.sample_count ||
      report.holdout_count < 1 ||
      report.training_count < 1
    )
      throw new Error("Calibration sample partition is inconsistent.");
  }
}
