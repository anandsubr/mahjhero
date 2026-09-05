// react-native-safe-area-context's own components reach into
// react-native/Libraries internals (codegen specs for its native Fabric
// component) that the react-native-web alias does not intercept and that
// Vitest's parser cannot handle. Tests run in jsdom, which has no notch or
// status bar to report, so a provider that renders its children untouched
// and an insets hook that always reports zero is a faithful stand-in, not a
// simplification of real behaviour.
import type { ReactNode } from 'react';

export function SafeAreaProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
