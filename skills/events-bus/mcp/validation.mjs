export const JOB_ID_PATTERN = "^[A-Za-z0-9_-]+$";

export function safeJobId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

export function safeTaskId(value) {
  return typeof value === "string" && value.trim().length > 0;
}
