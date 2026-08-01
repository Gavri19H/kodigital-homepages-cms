export class WorkerEntrypoint<Environment> {
  protected readonly env: Environment;

  constructor(_context: unknown, env: Environment) {
    this.env = env;
  }
}
