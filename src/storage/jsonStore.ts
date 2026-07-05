import fs from "node:fs/promises";
import path from "node:path";
import { emptyStore, storeSchema, type Store } from "./schema.js";

/**
 * A JSON-file store with atomic writes and in-process write serialization.
 *
 * Atomic write (PRD §6): serialize to a temp file, then `fs.rename` over the real
 * file. rename is atomic on the same filesystem, so a crash mid-write leaves the
 * previous store.json intact rather than a truncated file.
 */
export class JsonStore {
  private readonly filePath: string;
  private readonly tmpPath: string;
  private cache: Store | null = null;
  /** Serializes writes so concurrent saves never interleave. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.tmpPath = `${filePath}.tmp`;
  }

  /** Load from disk (seeding an empty store on first boot) and cache in memory. */
  async init(): Promise<Store> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cache = storeSchema.parse(JSON.parse(raw));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = emptyStore();
        await this.persist(this.cache);
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  /** Current in-memory store. Call init() first. */
  get(): Store {
    if (!this.cache) throw new Error("JsonStore not initialized — call init() first");
    return this.cache;
  }

  /**
   * Apply a mutation and atomically persist. Mutations are queued so they run one
   * at a time. The mutator receives the current store and may mutate it in place
   * and/or return a replacement.
   */
  async update(mutator: (store: Store) => Store | void): Promise<Store> {
    const run = async (): Promise<Store> => {
      const current = this.get();
      const result = mutator(current) ?? current;
      const validated = storeSchema.parse(result);
      await this.persist(validated);
      this.cache = validated;
      return validated;
    };
    const next = this.writeChain.then(run, run);
    // Keep the chain alive regardless of individual failures.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async persist(store: Store): Promise<void> {
    const json = JSON.stringify(store, null, 2);
    await fs.writeFile(this.tmpPath, json, "utf8");
    await fs.rename(this.tmpPath, this.filePath);
  }
}
