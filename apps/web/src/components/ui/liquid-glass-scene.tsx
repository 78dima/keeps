'use client';

import { useEffect } from 'react';

export function LiquidGlassScene() {
    useEffect(() => {
        const root = document.documentElement;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Tab') root.classList.add('keyboard-focus');
        };
        const onPointer = () => root.classList.remove('keyboard-focus');
        const onVisibility = () => root.classList.toggle('glass-paused', document.hidden);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('visibilitychange', onVisibility);
        onVisibility();
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('visibilitychange', onVisibility);
            root.classList.remove('keyboard-focus', 'glass-paused');
        };
    }, []);

    return <>
        <svg className="liquid-filter-definitions" width="0" height="0" aria-hidden="true" focusable="false">
            <defs>
                <filter id="monokeep-liquid" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency=".012 .009" numOctaves="2" seed="21" result="noise" />
                    <feGaussianBlur in="noise" stdDeviation="3" result="soft" />
                    <feDisplacementMap in="SourceGraphic" in2="soft" scale="60" xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </defs>
        </svg>
        <div className="liquid-water" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="liquid-bubble" />)}
        </div>
    </>;
}
