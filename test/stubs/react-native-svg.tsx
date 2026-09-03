// react-native-svg reaches into react-native internals that the
// react-native-web alias does not intercept. Icons carry no behaviour worth
// asserting here; the visual layer verifies they render.
import type { ReactNode } from 'react';

const Noop = ({ children }: { children?: ReactNode }) => <>{children}</>;

// Svg gets its own stub rather than reusing Noop: components/MahjongTile.tsx
// puts a `testID` on its dots/bamboo glyphs' <Svg> so
// app/__tests__/nav-glyph-parity.test.tsx can tell suits apart the same way
// it tells the character glyphs' own `<Text testID=...>` apart -- a bare
// Fragment has no host node to carry that attribute. Wraps children in a
// `<div data-testid=...>` only when a testID is actually supplied, so every
// other SVG icon in the app (none of which pass one) keeps rendering as a
// plain Fragment, unchanged from before.
const SvgStub = ({ children, testID }: { children?: ReactNode; testID?: string }) =>
  testID ? <div data-testid={testID}>{children}</div> : <>{children}</>;

export default SvgStub;
export const Svg = SvgStub;
export const Circle = Noop;
export const Path = Noop;
export const Rect = Noop;
export const G = Noop;
export const Line = Noop;
