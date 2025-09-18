import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { cn } from "@/lib/utils";

interface SpinProps {
    spinning?: boolean;
    tip?: string;
    size?: 'small' | 'default' | 'large';
    mask?: boolean; // 保持兼容：包裹子元素时显示遮罩
    delay?: number; // 毫秒延迟，类似 antd 的 delay
    indicator?: ReactNode; // 自定义指示器
    fullscreen?: boolean; // 全屏加载
    variant?: 'ring' | 'dots'; // 指示器风格：圆环 或 四点
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
}

export const Spin: React.FC<SpinProps> = ({
    spinning = true, // 默认显示加载状态
    tip,
    size = 'default',
    mask = false,
    delay,
    indicator,
    fullscreen = false,
    variant = 'ring',
    children,
    className = '',
    style,
}) => {
    // 延迟控制，仿 antd delay 行为
    const [shouldDisplay, setShouldDisplay] = useState<boolean>(spinning && !(delay && delay > 0));
    const delayTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!spinning) {
            if (delayTimerRef.current) {
                window.clearTimeout(delayTimerRef.current);
                delayTimerRef.current = null;
            }
            setShouldDisplay(false);
            return;
        }

        if (delay && delay > 0) {
            if (delayTimerRef.current) {
                window.clearTimeout(delayTimerRef.current);
            }
            delayTimerRef.current = window.setTimeout(() => {
                setShouldDisplay(true);
            }, delay) as unknown as number;
        } else {
            setShouldDisplay(true);
        }

        return () => {
            if (delayTimerRef.current) {
                window.clearTimeout(delayTimerRef.current);
                delayTimerRef.current = null;
            }
        };
    }, [spinning, delay]);

    // 根据尺寸映射动画大小（宽度/高度/边框宽度）
    const sizeMap = useMemo(() => ({
        small: { w: '1.25rem', h: '1.25rem', borderW: '0.15rem', tipText: 'text-xs' },
        default: { w: '1.75rem', h: '1.75rem', borderW: '0.2rem', tipText: 'text-sm' },
        large: { w: '2.25rem', h: '2.25rem', borderW: '0.25rem', tipText: 'text-base' },
    }), []);
    const { w, h, borderW, tipText } = sizeMap[size];

    // 如果不需要加载且有子内容，直接渲染子内容
    if (!shouldDisplay && children) {
        return <div className={className}>{children}</div>;
    }

    const renderRingIndicator = (
        <div
            className={cn(
                'animate-spin rounded-full border-solid',
                'border-t-blue-500 border-r-gray-200 border-b-gray-200 border-l-gray-200'
            )}
            style={{ width: w, height: h, borderWidth: borderW }}
        />
    );

    const renderDotsIndicator = (() => {
        // 计算点大小与间距
        const dotMap = {
            small: { size: 6, gap: 2 },
            default: { size: 8, gap: 3 },
            large: { size: 10, gap: 4 },
        } as const;
        const { size: dotSize, gap } = dotMap[size];
        const baseDotStyle: CSSProperties = {
            width: dotSize,
            height: dotSize,
        };

        // 使用容器旋转 + 各点淡入淡出延迟，近似 antd 四点动画
        return (
            <div className="relative" style={{ width: w, height: h }}>
                <div className="absolute inset-0 flex items-center justify-center animate-spin" style={{ animationDuration: '1.2s' }}>
                    <div className="grid" style={{ gridTemplateColumns: `repeat(2, ${dotSize}px)`, gridTemplateRows: `repeat(2, ${dotSize}px)`, gap }}>
                        <span
                            className="rounded-full bg-blue-500/90 animate-pulse"
                            style={{ ...baseDotStyle, animationDelay: '0ms' }}
                        />
                        <span
                            className="rounded-full bg-blue-400/90 animate-pulse"
                            style={{ ...baseDotStyle, animationDelay: '150ms' }}
                        />
                        <span
                            className="rounded-full bg-blue-400/80 animate-pulse"
                            style={{ ...baseDotStyle, animationDelay: '300ms' }}
                        />
                        <span
                            className="rounded-full bg-blue-300/80 animate-pulse"
                            style={{ ...baseDotStyle, animationDelay: '450ms' }}
                        />
                    </div>
                </div>
            </div>
        );
    })();

    const content = (
        <div className={cn('flex items-center justify-center', tip ? 'gap-2' : undefined)} role="status" aria-live="polite" aria-busy={shouldDisplay}>
            {indicator ? indicator : (variant === 'dots' ? renderDotsIndicator : renderRingIndicator)}
            {tip ? (
                <span className={cn('text-gray-600', tipText)}>{tip}</span>
            ) : null}
        </div>
    );

    if (fullscreen && shouldDisplay) {
        return (
            <div className={cn('fixed inset-0 z-50 flex items-center justify-center bg-white/60', className)} style={style}>
                {content}
            </div>
        );
    }

    // 无子元素：独立模式
    if (!children) {
        return (
            <div className={cn('inline-flex items-center justify-center py-4', className)} style={style}>
                {shouldDisplay ? content : null}
            </div>
        );
    }

    // 包裹模式：覆盖在子内容之上
    return (
        <div className={cn('relative', className)} style={style}>
            <div className={cn(shouldDisplay ? 'opacity-60' : 'opacity-100', 'transition-opacity')}>{children}</div>
            {shouldDisplay && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                    {/* 遮罩层（mask 或默认轻遮罩） */}
                    <div className={cn('absolute inset-0', mask ? 'bg-white/70 backdrop-blur-sm' : 'bg-white/40')} aria-hidden="true" />
                    <div className="relative z-20">{content}</div>
                </div>
            )}
        </div>
    );
};
