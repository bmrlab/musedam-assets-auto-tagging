export class JinaUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`JINA_UNAVAILABLE: ${message}`, options);
    this.name = "JinaUnavailableError";
  }
}

/** Per-process, per-endpoint breaker. Old in-flight results cannot close a newer circuit. */
export class JinaCircuit {
  private failures = 0;
  private openUntil = 0;
  private probe = false;
  private generation = 0;
  constructor(
    private threshold = 3,
    private cooldownMs = 60_000,
  ) {}
  assertAvailable(now = Date.now()) {
    if (this.openUntil && (now < this.openUntil || this.probe)) {
      throw new JinaUnavailableError("circuit open; feature retrieval temporarily skipped");
    }
  }
  acquire(now = Date.now()) {
    this.assertAvailable(now);
    const probing = this.openUntil > 0;
    if (probing) this.probe = true;
    const generation = this.generation;
    let finished = false;
    return (outcome: "success" | "failure" | "ignore") => {
      if (finished || generation !== this.generation) return;
      finished = true;
      if (probing) this.probe = false;
      if (outcome === "success") {
        this.failures = 0;
        this.openUntil = 0;
      } else if (outcome === "failure" && (probing || ++this.failures >= this.threshold)) {
        this.openUntil = Date.now() + this.cooldownMs;
        this.generation++;
      }
    };
  }
}
const circuits = new Map<string, JinaCircuit>();
export function getJinaCircuit(key: string) {
  let circuit = circuits.get(key);
  if (!circuit) {
    circuit = new JinaCircuit();
    circuits.set(key, circuit);
  }
  return circuit;
}
