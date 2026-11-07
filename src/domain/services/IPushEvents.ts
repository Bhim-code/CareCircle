/** What happens on the phone when a notification from the server arrives. */
export interface IPushEvents {
  /**
   * Calls `listener` when the person taps a notification from the server, including the one
   * that opened the app. Returns a function that stops listening.
   */
  onTap(listener: () => void): () => void;
}
