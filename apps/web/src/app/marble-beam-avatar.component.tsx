import Avatar from 'boring-avatars';
import type { SVGProps } from 'react';

const AVATAR_PALETTE = ['#9b5de5', '#f15bb5', '#fee440', '#00bbf9', '#00f5d4'];

export type MarbleBeamAvatarProps = SVGProps<SVGSVGElement> & {
  name: string;
  colors?: string[];
  size?: number | string;
  /**
   * Default is the circular Beam avatar used by Agents. `'app'` renders the
   * SVG as a square (filled square corners) so a parent class can apply an
   * app-style squircle border radius to differentiate Skills from Agents.
   */
  shape?: 'circle' | 'app';
  title?: boolean;
};

/**
 * AIR Office avatar wrapper around boring-avatars' native Beam variant.
 * The palette stays below the library's contrast threshold so Beam renders
 * its eyes and mouth in white while retaining saturated, varied colors.
 */
export function MarbleBeamAvatar({
  name,
  colors = AVATAR_PALETTE,
  size = 40,
  shape = 'circle',
  title = false,
  ...props
}: MarbleBeamAvatarProps) {
  const square = shape === 'app';
  const className = square && props.className
    ? `${props.className} avatar-app`
    : square
      ? 'avatar-app'
      : props.className;
  return <Avatar name={name} variant="beam" colors={colors} size={size} square={square} title={title} {...props} className={className} />;
}
