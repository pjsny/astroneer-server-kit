import React from 'react';
import { Box, Text, useAnimation } from 'ink';
import { colors, starFrames } from './theme.js';

interface HeaderProps {
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ subtitle }) => {
  const { frame } = useAnimation({ interval: 450 });
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
        <Text color={colors.orange} bold>ASTRONEER  SERVER  KIT</Text>
        <Text color={colors.gold}>{star}</Text>
      </Box>
      <Text color={colors.muted}>
        {subtitle ?? 'deploy · explore · play together'}
      </Text>
    </Box>
  );
};
