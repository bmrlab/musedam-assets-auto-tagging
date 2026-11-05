/** Display the existing name-keyed records response without exposing snapshot internals or option IDs. */
export function metadataDisplayValues(values: Record<string, unknown> = {}) {
  const snapshot = values.__metadata as
    | { fields?: { name: string; options?: { id: string; label: string }[] }[] }
    | undefined;
  return Object.entries(values)
    .filter(
      ([name, value]) =>
        !["materialId", "recordId", "__metadata"].includes(name) &&
        value !== null &&
        value !== undefined &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0),
    )
    .map(([name, value]) => {
      const labels = new Map(
        snapshot?.fields
          ?.find((field) => field.name === name)
          ?.options?.map((option) => [option.id, option.label]) || [],
      );
      const display = (entry: unknown): unknown =>
        Array.isArray(entry)
          ? entry.map(display)
          : typeof entry === "string"
            ? (labels.get(entry) ?? entry)
            : entry;
      return { name, value: display(value) };
    });
}
