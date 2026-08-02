/** Shared reporting helpers for the native and browser performance harnesses. */

export const PERFORMANCE_SCHEMA_VERSION = 1;

const finite = (value, label) => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
};

const validatePercentile = (values, quantile) => {
  if (values.length === 0) {
    throw new Error('cannot calculate a percentile without samples');
  }
  if (quantile < 0 || quantile > 1) {
    throw new Error('percentile quantile must be between zero and one');
  }
};

const interpolatePercentile = (sorted, quantile) => {
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? 0;
  const fraction = position - lower;
  return lowerValue + (upperValue - lowerValue) * fraction;
};

const percentile = (values, quantile) => {
  validatePercentile(values, quantile);
  const sorted = values.map((value) => finite(value, 'sample')).sort((a, b) => a - b);
  return interpolatePercentile(sorted, quantile);
};

export const summarizeSamples = (samples, fields) =>
  Object.fromEntries(
    fields.map((field) => {
      const values = samples.map((sample) => finite(sample[field], field));
      return [field, { median: percentile(values, 0.5), p95: percentile(values, 0.95) }];
    }),
  );

export const writeJson = async (filePath, value) => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
