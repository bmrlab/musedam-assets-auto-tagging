/**
 * 主题配置 - 参考 minidam-app 项目的配色系统
 * 与 next-themes 集成
 * @owner auto-tagging
 */

export enum ETheme {
    light = 'light',
    dark = 'dark'
}

const commonVariables = {
    'fixed-0': '#000000',
    'fixed-F': '#FFFFFF',
    'danger-1': 'rgba(255, 242, 242, 1)',
    'danger-2': 'rgba(255, 229, 231, 1)',
    'danger-3': 'rgba(255, 214, 217, 1)',
    'danger-4': 'rgba(255, 168, 180, 1)',
    'danger-5': 'rgba(255, 112, 141, 1)',
    'danger-6': 'rgba(255, 61, 113, 1)',
    'danger-7': 'rgba(219, 44, 102, 1)',
    'danger-8': 'rgba(184, 29, 91, 1)',
    'danger-9': 'rgba(148, 18, 78, 1)',
    'danger-10': 'rgba(112, 9, 64, 1)',

    'dark-primary-1': 'rgba(31, 31, 31, 1)',
    'primary-t-1': 'rgba(51, 102, 255, 0.03)',
    'primary-t-2': 'rgba(51, 102, 255, 0.05)',
    'primary-t-3': 'rgba(51, 102, 255, 0.1)',
    'primary-t-4': 'rgba(51, 102, 255, 0.15)',
    'primary-t-5': 'rgba(51, 102, 255, 0.2)',
    'primary-t-6': 'rgba(51, 102, 255, 0.25)',
    'primary-t-7': 'rgba(51, 102, 255, 0.3)',
    'primary-t-8': 'rgba(51, 102, 255, 0.4)',
    'primary-t-9': 'rgba(51, 102, 255, 0.5)',
    'primary-t-10': 'rgba(51, 102, 255, 0.6)',
    'primary-t-11': 'rgba(51, 102, 255, 0.7)',
    'primary-t-12': 'rgba(51, 102, 255, 0.8)',
    'primary-t-13': 'rgba(51, 102, 255, 0.9)'
};

export const themeVars = {
    [ETheme.light]: {
        ...commonVariables,
        'box-shadow': '0 3px 6px -4px rgb(0 0 0 / 12%), 0 6px 16px 0 rgb(0 0 0 / 8%), 0 9px 28px 8px rgb(0 0 0 / 5%)',
        'background-color': '#fff',
        'modal-mask-background-color': 'rgba(0, 0, 0, 0.35)',
        'basic-0': 'rgba(255, 255, 255, 1)',
        'basic-1': 'rgba(247, 249, 252, 1)',
        'basic-2': 'rgba(237, 241, 247, 1)',
        'basic-3': 'rgba(228, 233, 242, 1)',
        'basic-4': 'rgba(197, 206, 224, 1)',
        'basic-5': 'rgba(143, 155, 179, 1)',
        'basic-6': 'rgba(46, 58, 89, 1)',
        'basic-7': 'rgba(34, 43, 69, 1)',
        'basic-8': 'rgba(25, 32, 56, 1)',
        'basic-9': 'rgba(21, 26, 48, 1)',
        'basic-10': 'rgba(16, 20, 38, 1)',
        'basic-dark-0': 'rgba(16, 20, 38, 1)',
        'basic-dark-7': 'rgba(246, 247, 249, 1)',
        'basic-dark-10': 'rgba(255, 255, 255, 1)',
        'basic-1-mixin-2': 'rgba(247, 249, 252, 1)',
        'primary-10': 'rgba(9, 28, 122, 1)',
        'primary-9': 'rgba(16, 38, 148, 1)',
        'primary-8': 'rgba(26, 52, 184, 1)',
        'primary-7': 'rgba(39, 75, 219, 1)',
        'primary-6': 'rgba(51, 102, 255, 1)', // 主色调 #3366FF
        'primary-5': 'rgba(89, 139, 255, 1)',
        'primary-4': 'rgba(115, 157, 255, 1)',
        'primary-3': 'rgba(166, 193, 255, 1)',
        'primary-2': 'rgba(217, 228, 255, 1)',
        'primary-1': 'rgba(242, 246, 255, 1)',
        'primary-f-1': 'rgba(242, 246, 255, 0.8)',
        'basic-f-1': 'rgba(0, 0, 0, 0.1)',
        'basic-f-2': 'rgba(0, 0, 0, 0.2)',
        'basic-f-3': 'rgba(0, 0, 0, 0.3)',
        'basic-f-4': 'rgba(0, 0, 0, 0.4)',
        'basic-f-5': 'rgba(0, 0, 0, 0.5)',
        'basic-f-7': 'rgba(0, 0, 0, 0.7)',
        'basic-f-8': 'rgba(0, 0, 0, 0.8)',
        'basic-f-10': '#000000',
        'basic-w-f-1': 'rgba(255, 255, 255, 0.1)',
        'basic-w-f-2': 'rgba(255, 255, 255, 0.2)',
        'basic-w-f-3': 'rgba(255, 255, 255, 0.3)',
        'basic-w-f-4': 'rgba(255, 255, 255, 0.4)',
        'basic-w-f-5': 'rgba(255, 255, 255, 0.5)',
        'basic-w-f-7': 'rgba(255, 255, 255, 0.7)',
        'basic-w-f-8': 'rgba(255, 255, 255, 0.8)',
        'basic-w-f-10': '#FFFFFF',

        'warning-1': 'rgba(255, 253, 242, 1)',
        'warning-2': 'rgba(255, 247, 219, 1)',
        'warning-3': 'rgba(255, 241, 194, 1)',
        'warning-4': 'rgba(255, 229, 158, 1)',
        'warning-5': 'rgba(255, 201, 77, 1)',
        'warning-6': 'rgba(255, 170, 0, 1)',
        'warning-7': 'rgba(219, 139, 0, 1)',
        'warning-8': 'rgba(184, 110, 0, 1)',
        'warning-9': 'rgba(148, 84, 0, 1)',

        'success-1': 'rgba(246, 255, 237, 1)',
        'success-2': 'rgba(237, 255, 219, 1)',
        'success-3': 'rgba(214, 255, 194, 1)',
        'success-4': 'rgba(168, 255, 180, 1)',
        'success-5': 'rgba(112, 255, 141, 1)',
        'success-6': 'rgba(0, 224, 150, 1)',
        'success-7': 'rgba(0, 192, 128, 1)',
        'success-8': 'rgba(0, 160, 106, 1)',
        'success-9': 'rgba(0, 128, 84, 1)',

        'billing-image': 'linear-gradient(180deg, #F1F5FF 0%, #E7EFFF 100%)',
        'billing-card': 'linear-gradient(180deg, #F1F5FF 0%, #F1F5FF 100%)',
        'billing-primary': 'rgba(51, 102, 255, 1)',
        'billing-tip': 'rgba(51, 102, 255, 1)',
        'setting-linear': 'linear-gradient(180deg, #D9E4FF 0%, rgba(255, 255, 255, 0) 100%), rgba(255, 255, 255, 0.001);',

        'dataSafety-bg1': '#E4EDFF',
        'dataSafety-bg2': ' #D9E4FF',
        'dataSafety-bg3': '#F2F6FF',
        'landing-bg1': 'linear-gradient(180deg, #F2F6FF 0%, #A6C1FF 100%)',

        'theme-background': '#FFFFFF',

        'description-border': "#E4E9F2"
    },
    [ETheme.dark]: {
        ...commonVariables,
        'box-shadow':
            '0 3px 6px -4px rgba(0, 0, 0, 0.48), 0 6px 16px 0 rgba(0, 0, 0, 0.32), 0 9px 28px 8px rgba(0, 0, 0, 0.2)',
        'modal-mask-background-color': 'rgba(0, 0, 0, 0.35)',
        'background-color': 'var(--ant-basic-2)',
        'basic-dark-0': 'rgba(20, 20, 20, 1)',
        'basic-dark-7': 'rgba(67, 67, 67, 1)',
        'basic-dark-10': 'rgba(20, 20, 20, 1)',
        'basic-10': 'rgba(255, 255, 255, 1)',
        'basic-9': 'rgba(250, 250, 250, 1)',
        'basic-8': 'rgba(245, 245, 245, 1)',
        'basic-7': 'rgba(240, 240, 240, 1)',
        'basic-6': 'rgba(191, 191, 191, 1)',
        'basic-5': 'rgba(140, 140, 140, 1)',
        'basic-4': 'rgba(89, 89, 89, 1)',
        'basic-3': 'rgba(67, 67, 67, 1)',
        'basic-2': 'rgba(38, 38, 38, 1)',
        'basic-1': 'rgba(31, 31, 31, 1)',
        'basic-0': 'rgba(20, 20, 20, 1)',
        'basic-f-1': 'rgba(255, 255, 255, 0.1)',
        'basic-f-2': 'rgba(255, 255, 255, 0.2)',
        'basic-f-3': 'rgba(255, 255, 255, 0.3)',
        'basic-f-4': 'rgba(255, 255, 255, 0.4)',
        'basic-f-5': 'rgba(255, 255, 255, 0.5)',
        'basic-f-7': 'rgba(255, 255, 255, 0.7)',
        'basic-f-8': 'rgba(255, 255, 255, 0.8)',
        'basic-f-10': '#FFFFFF',
        'basic-1-mixin-2': 'rgba(38, 38, 38, 1)',
        'basic-w-f-1': 'rgba(0, 0, 0, 0.1)',
        'basic-w-f-2': 'rgba(0, 0, 0, 0.2)',
        'basic-w-f-3': 'rgba(0, 0, 0, 0.3)',
        'basic-w-f-4': 'rgba(0, 0, 0, 0.4)',
        'basic-w-f-5': 'rgba(0, 0, 0, 0.5)',
        'basic-w-f-7': 'rgba(0, 0, 0, 0.7)',
        'basic-w-f-8': 'rgba(0, 0, 0, 0.8)',
        'basic-w-f-10': '#000000',

        'primary-1': 'rgba(9, 28, 122, 1)',
        'primary-2': 'rgba(16, 38, 148, 1)',
        'primary-3': 'rgba(26, 52, 184, 1)',
        'primary-4': 'rgba(39, 75, 219, 1)',
        'primary-5': 'rgba(51, 102, 255, 1)',
        'primary-6': 'rgba(89, 139, 255, 1)', // 在暗色主题中，primary-6 变成了较亮的蓝色
        'primary-7': 'rgba(115, 157, 255, 1)',
        'primary-8': 'rgba(166, 193, 255, 1)',
        'primary-9': 'rgba(217, 228, 255, 1)',
        'primary-10': 'rgba(242, 246, 255, 1)',

        'warning-9': 'rgba(255, 253, 242, 1)',
        'warning-8': 'rgba(255, 247, 219, 1)',
        'warning-7': 'rgba(255, 241, 194, 1)',
        'warning-6': 'rgba(255, 229, 158, 1)',
        'warning-5': 'rgba(255, 201, 77, 1)',
        'warning-4': 'rgba(255, 170, 0, 1)',
        'warning-3': 'rgba(219, 139, 0, 1)',
        'warning-2': 'rgba(184, 110, 0, 1)',
        'warning-1': 'rgba(148, 84, 0, 1)',

        'success-9': 'rgba(246, 255, 237, 1)',
        'success-8': 'rgba(237, 255, 219, 1)',
        'success-7': 'rgba(214, 255, 194, 1)',
        'success-6': 'rgba(168, 255, 180, 1)',
        'success-5': 'rgba(112, 255, 141, 1)',
        'success-4': 'rgba(0, 224, 150, 1)',
        'success-3': 'rgba(0, 192, 128, 1)',
        'success-2': 'rgba(0, 160, 106, 1)',
        'success-1': 'rgba(0, 128, 84, 1)',

        'billing-image': 'linear-gradient(180deg, #222222 0%, #000000 100%)',
        'billing-card': 'linear-gradient(180deg, #222222 0%, #000000 100%)',
        'billing-primary': 'rgba(255, 255, 255, 1)',
        'billing-tip': 'rgba(242, 246, 255, 1)',
        'setting-linear': 'linear-gradient(180deg, rgba(39, 75, 219, 0.2) 0%, rgba(51, 102, 255, 0) 100%);',

        'dataSafety-bg1': '#262626',
        'dataSafety-bg2': '#1F1F1F',
        'dataSafety-bg3': '#141414',
        'landing-bg1': 'linear-gradient(180deg, #141414 0%, #000000 100%);',
        'theme-background': 'rgba(31, 31, 31, 1)',

        'description-border': "#262626"
    }
};

// 检测操作系统主题偏好
export function getSystemTheme(): ETheme {
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? ETheme.dark : ETheme.light;
    }
    return ETheme.light;
}

// 将 next-themes 的主题字符串转换为我们的枚举
export function mapNextThemesToETheme(theme: string | undefined): ETheme {
    if (theme === 'dark') return ETheme.dark;
    if (theme === 'light') return ETheme.light;
    return getSystemTheme();
}

// 获取当前主题的配色变量
export function getThemeVars(theme: ETheme) {
    return themeVars[theme];
}

// 导出常用的配色变量，方便在组件中使用
export const colors = {
    primary: {
        1: 'var(--ant-primary-1)',
        2: 'var(--ant-primary-2)',
        3: 'var(--ant-primary-3)',
        4: 'var(--ant-primary-4)',
        5: 'var(--ant-primary-5)',
        6: 'var(--ant-primary-6)', // 主色调
        7: 'var(--ant-primary-7)',
        8: 'var(--ant-primary-8)',
        9: 'var(--ant-primary-9)',
        10: 'var(--ant-primary-10)',
    },
    basic: {
        0: 'var(--ant-basic-0)',
        1: 'var(--ant-basic-1)',
        2: 'var(--ant-basic-2)',
        3: 'var(--ant-basic-3)',
        4: 'var(--ant-basic-4)',
        5: 'var(--ant-basic-5)',
        6: 'var(--ant-basic-6)',
        7: 'var(--ant-basic-7)',
        8: 'var(--ant-basic-8)',
        9: 'var(--ant-basic-9)',
        10: 'var(--ant-basic-10)',
    },
    success: {
        1: 'var(--ant-success-1)',
        2: 'var(--ant-success-2)',
        3: 'var(--ant-success-3)',
        4: 'var(--ant-success-4)',
        5: 'var(--ant-success-5)',
        6: 'var(--ant-success-6)',
        7: 'var(--ant-success-7)',
        8: 'var(--ant-success-8)',
        9: 'var(--ant-success-9)',
    },
    warning: {
        1: 'var(--ant-warning-1)',
        2: 'var(--ant-warning-2)',
        3: 'var(--ant-warning-3)',
        4: 'var(--ant-warning-4)',
        5: 'var(--ant-warning-5)',
        6: 'var(--ant-warning-6)',
        7: 'var(--ant-warning-7)',
        8: 'var(--ant-warning-8)',
        9: 'var(--ant-warning-9)',
    },
    danger: {
        1: 'var(--ant-danger-1)',
        2: 'var(--ant-danger-2)',
        3: 'var(--ant-danger-3)',
        4: 'var(--ant-danger-4)',
        5: 'var(--ant-danger-5)',
        6: 'var(--ant-danger-6)',
        7: 'var(--ant-danger-7)',
        8: 'var(--ant-danger-8)',
        9: 'var(--ant-danger-9)',
    },
} as const;
