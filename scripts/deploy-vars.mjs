export function validateRequired(selected, names, label) {
  const invalid = names.filter((name) =>
    !Object.hasOwn(selected, name) ||
    typeof selected[name] !== "string" ||
    selected[name].trim() === ""
  );
  if (invalid.length) {
    throw new Error(`Missing or empty ${label}: ${invalid.join(", ")}`);
  }
}
