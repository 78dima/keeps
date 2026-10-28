import type { CSSProperties } from 'react';

// Keep the original stored color; translucency belongs only to the presentation.
export function noteGlassStyle(color?: string | null): CSSProperties {
    const hex = /^#[\da-f]{6}$/i.test(color || '') ? color!.slice(1) : 'ffffff';
    const rgb = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(' ');
    return { '--note-rgb': rgb } as CSSProperties;
}
