import type { PickedFile } from '../entities/HealthRecord';

/**
 * Choosing a photo or a file on the phone. Each method answers with the file, or null
 * when the person cancelled. They reject with an Error whose message is for the person
 * when something stops them, such as a refused permission.
 */
export interface IFilePicker {
  takePhoto(): Promise<PickedFile | null>;
  choosePhoto(): Promise<PickedFile | null>;
  choosePdf(): Promise<PickedFile | null>;
}
