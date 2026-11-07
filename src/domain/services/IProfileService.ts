/** The details a person can change about themselves. Rejects with an error that has a `code`. */
export interface IProfileService {
  /** Saves a new name and returns the name the server holds now. */
  updateName(name: string): Promise<string>;
}
