// Small in-process job queue: limits how many AI requests are in flight at once and lets
// evaluations run in the background while the candidate moves on to the next question.
export class AIQueue {
  private running = 0;
  private waiting: Array<{ job: () => Promise<unknown>; resolve: (v: any) => void; reject: (e: unknown) => void }> = [];

  constructor(private concurrency = 8) {}

  add<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ job, resolve, reject });
      this.next();
    });
  }

  get size(): number {
    return this.waiting.length + this.running;
  }

  private next(): void {
    while (this.running < this.concurrency && this.waiting.length) {
      const { job, resolve, reject } = this.waiting.shift()!;
      this.running++;
      Promise.resolve()
        .then(job)
        .then(resolve, reject)
        .finally(() => {
          this.running--;
          this.next();
        });
    }
  }
}
