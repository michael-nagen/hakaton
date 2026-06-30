import { ICONS } from '../data/icons';

interface AppIconProps {
  name: string;
  size?: number;
}

export function AppIcon({ name, size = 22 }: AppIconProps) {
  const path = ICONS[name] ?? '';
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return (
    <span
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
