import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors, radius } from '../lib/theme';

/**
 * One shimmering placeholder block, replacing the full-screen spinner while
 * the dashboard's own content loads. The artboard stacks three, staggered by
 * `delay`, which is why the stagger is a prop rather than baked in.
 *
 * `@keyframes shimmer { 0%, 100% { opacity: .5 } 50% { opacity: .9 } }` in
 * the design; a two-leg Animated sequence is the same curve.
 */
export default function Skeleton({ delay = 0 }: { delay?: number }) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 600,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    // Stopped on unmount: a running loop holds a reference to the component's
    // Animated.Value and keeps ticking after the content has arrived.
    return () => loop.stop();
  }, [opacity, delay]);

  return (
    <Animated.View
      testID="skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    height: 86,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
});
