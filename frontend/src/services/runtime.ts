/** Only the explicit static-host build enables browser execution. */
export const browserHosted =
  typeof document !== "undefined" &&
  document.querySelector('meta[name="tds-runtime"]')?.getAttribute("content") === "browser";
