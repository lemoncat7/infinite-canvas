/** An intentional application rejection; Fastify preserves its HTTP status. */
export class ApplicationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
