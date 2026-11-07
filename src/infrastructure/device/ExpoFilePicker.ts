import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { PickedFile } from '../../domain/entities/HealthRecord';
import type { IFilePicker } from '../../domain/services/IFilePicker';

const CAMERA_REFUSED =
  'CareCircle needs the camera to take a photo. You can allow it in your phone settings, or choose a photo instead.';
const PHOTOS_REFUSED =
  'CareCircle needs access to your photos. You can allow it in your phone settings, or choose a PDF instead.';

function nameFrom(uri: string, fallback: string): string {
  const last = uri.split('?')[0].split('/').pop();
  return last && last.includes('.') ? decodeURIComponent(last) : fallback;
}

function fromImage(asset: ImagePicker.ImagePickerAsset, fallbackName: string): PickedFile {
  return {
    uri: asset.uri,
    name: asset.fileName ?? nameFrom(asset.uri, fallbackName),
    mimeType: asset.mimeType ?? 'image/jpeg',
    sizeBytes: typeof asset.fileSize === 'number' ? asset.fileSize : null,
  };
}

/** Photos from the camera or library, and PDFs from the phone's files. */
export class ExpoFilePicker implements IFilePicker {
  async takePhoto(): Promise<PickedFile | null> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error(CAMERA_REFUSED);
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || result.assets.length === 0) return null;
    return fromImage(result.assets[0], 'photo.jpg');
  }

  async choosePhoto(): Promise<PickedFile | null> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(PHOTOS_REFUSED);
    // Keep the original file (including HEIC), which the backend accepts.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || result.assets.length === 0) return null;
    return fromImage(result.assets[0], 'photo.jpg');
  }

  async choosePdf(): Promise<PickedFile | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'application/pdf',
      sizeBytes: typeof asset.size === 'number' ? asset.size : null,
    };
  }
}
