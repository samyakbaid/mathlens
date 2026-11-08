// Errors shared by the AI providers.

/** An error whose message is safe and helpful to show in the browser. */
export class UserFacingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
