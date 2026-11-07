/** What asking this phone for its push token found out. */
export type PushTokenResult =
  /** This phone's address for notifications, which the server uses to reach it. */
  | { readonly kind: 'token'; readonly token: string }
  /** The person has not allowed notifications. We never ask by ourselves here. */
  | { readonly kind: 'denied' }
  /** This phone cannot get a token (an emulator, a build without the setup, no network to the push service). */
  | { readonly kind: 'unavailable'; readonly reason: string };
