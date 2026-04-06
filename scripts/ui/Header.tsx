import React from 'react';
import { Box, Text } from 'ink';
import { colors, starFrames } from './theme.js';
import { useFrame } from './useFrame.js';

interface HeaderProps {
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ subtitle }) => {
  const frame = useFrame(450);
  const star = starFrames[frame % starFrames.length];

  return (
    <Box
      borderStyle="round"
      borderColor={colors.orange}
      flexDirection="column"
      alignItems="center"
      paddingX={4}
      paddingY={1}
      marginBottom={1}
    >
      <Box gap={2}>
        <Text color={colors.gold}>{star}</Text>
        <Text color={colors.orange} bold>ASTRONEER</Text>
        <Text color={colors.teal} bold>SERVER</Text>
        <Text color={colors.purple} bold>KIT</Text>
        <Text color={colors.gold}>{star}</Text>
      </Box>
      <Text color={colors.muted}>
        <Text color={colors.teal}>deploy</Text>
        {' · '}
        <Text color={colors.orange}>explore</Text>
        {' · '}
        <Text color={colors.purple}>play together</Text>
      </Text>
    </Box>
  );
};
