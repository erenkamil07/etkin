import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { putJpeg } from '@/api/upload';

const SIZE = 400;

/**
 * Lets the student pick a photo and crop it square (the phone's own picker, no
 * storage permission), then shrinks it to 400 px, about 40 KB.
 */
export async function pickProfilePhoto(): Promise<string | null> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  // The web and some phones skip the crop step: take the middle square ourselves so a face isn't squashed.
  const side = Math.min(asset.width, asset.height);
  if (side > 0 && asset.width !== asset.height) {
    context.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  context.resize({ width: SIZE, height: SIZE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}

/** Uploads the photo; the API strips its metadata and returns where it lives. */
export function uploadProfilePhoto(uri: string) {
  return putJpeg<{ avatarUrl: string }>('/me/avatar', uri);
}
