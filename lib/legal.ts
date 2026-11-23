import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export type LegalKind = 'privacy' | 'terms';

export const LEGAL_URLS: Record<LegalKind, string> = {
  privacy: 'https://mahjhero.com/privacy/',
  terms: 'https://mahjhero.com/terms/',
};

/**
 * Opens the privacy policy or terms. In-app browser on native; a new tab on
 * web (noopener, so the page can't reach back into the app).
 */
export async function openLegal(kind: LegalKind): Promise<void> {
  const url = LEGAL_URLS[kind];
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
