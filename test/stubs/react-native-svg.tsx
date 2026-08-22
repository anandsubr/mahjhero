// react-native-svg reaches into react-native internals that the
// react-native-web alias does not intercept. Icons carry no behaviour worth
// asserting here; the visual layer verifies they render.
import type { ReactNode } from 'react';

const Noop = ({ children }: { children?: ReactNode }) => <>{children}</>;

export default Noop;
export const Svg = Noop;
export const Circle = Noop;
export const Path = Noop;
export const Rect = Noop;
export const G = Noop;
export const Line = Noop;
