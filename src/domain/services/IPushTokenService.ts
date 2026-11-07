/**
 * Tells the server which phone to send the signed-in person's notifications to.
 * Both methods reject with an error that has a `code`, for example "network".
 */
export interface IPushTokenService {
  register(token: string): Promise<void>;
  unregister(token: string): Promise<void>;
}
