import { useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { PRESS_SPRING, useMotion } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** How far it sinks under a finger: buttons a little more than big cards. */
  scaleTo?: number;
};

/**
 * A Pressable that sinks slightly while held and springs back on release, so a
 * tap feels physical. With reduce motion on it keeps only the colour change.
 */
export function PressableScale({ style, scaleTo = 0.97, onPressIn, onPressOut, ...props }: Props) {
  const motion = useMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        setPressed(true);
        if (motion) scale.value = withSpring(scaleTo, PRESS_SPRING);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        scale.value = withSpring(1, PRESS_SPRING);
        onPressOut?.(event);
      }}
      style={[typeof style === 'function' ? style({ pressed }) : style, animated]}
    />
  );
}
