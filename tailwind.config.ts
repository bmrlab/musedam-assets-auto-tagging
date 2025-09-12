import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                // Ant Design 配色系统 - 参考 minidam-app 项目
                // Primary 颜色系列
                'primary-1': 'var(--ant-primary-1)',
                'primary-2': 'var(--ant-primary-2)',
                'primary-3': 'var(--ant-primary-3)',
                'primary-4': 'var(--ant-primary-4)',
                'primary-5': 'var(--ant-primary-5)',
                'primary-6': 'var(--ant-primary-6)', // 主色调
                'primary-7': 'var(--ant-primary-7)',
                'primary-8': 'var(--ant-primary-8)',
                'primary-9': 'var(--ant-primary-9)',
                'primary-10': 'var(--ant-primary-10)',

                // Primary 透明度系列
                'primary-t-1': 'var(--ant-primary-t-1)',
                'primary-t-2': 'var(--ant-primary-t-2)',
                'primary-t-3': 'var(--ant-primary-t-3)',
                'primary-t-4': 'var(--ant-primary-t-4)',
                'primary-t-5': 'var(--ant-primary-t-5)',
                'primary-t-6': 'var(--ant-primary-t-6)',
                'primary-t-7': 'var(--ant-primary-t-7)',
                'primary-t-8': 'var(--ant-primary-t-8)',
                'primary-t-9': 'var(--ant-primary-t-9)',
                'primary-t-10': 'var(--ant-primary-t-10)',
                'primary-t-11': 'var(--ant-primary-t-11)',
                'primary-t-12': 'var(--ant-primary-t-12)',
                'primary-t-13': 'var(--ant-primary-t-13)',

                // Basic 颜色系列
                'basic-0': 'var(--ant-basic-0)',
                'basic-1': 'var(--ant-basic-1)',
                'basic-2': 'var(--ant-basic-2)',
                'basic-3': 'var(--ant-basic-3)',
                'basic-4': 'var(--ant-basic-4)',
                'basic-5': 'var(--ant-basic-5)',
                'basic-6': 'var(--ant-basic-6)',
                'basic-7': 'var(--ant-basic-7)',
                'basic-8': 'var(--ant-basic-8)',
                'basic-9': 'var(--ant-basic-9)',
                'basic-10': 'var(--ant-basic-10)',

                // Success 颜色系列
                'success-1': 'var(--ant-success-1)',
                'success-2': 'var(--ant-success-2)',
                'success-3': 'var(--ant-success-3)',
                'success-4': 'var(--ant-success-4)',
                'success-5': 'var(--ant-success-5)',
                'success-6': 'var(--ant-success-6)',
                'success-7': 'var(--ant-success-7)',
                'success-8': 'var(--ant-success-8)',
                'success-9': 'var(--ant-success-9)',

                // Warning 颜色系列
                'warning-1': 'var(--ant-warning-1)',
                'warning-2': 'var(--ant-warning-2)',
                'warning-3': 'var(--ant-warning-3)',
                'warning-4': 'var(--ant-warning-4)',
                'warning-5': 'var(--ant-warning-5)',
                'warning-6': 'var(--ant-warning-6)',
                'warning-7': 'var(--ant-warning-7)',
                'warning-8': 'var(--ant-warning-8)',
                'warning-9': 'var(--ant-warning-9)',

                // Danger 颜色系列
                'danger-1': 'var(--ant-danger-1)',
                'danger-2': 'var(--ant-danger-2)',
                'danger-3': 'var(--ant-danger-3)',
                'danger-4': 'var(--ant-danger-4)',
                'danger-5': 'var(--ant-danger-5)',
                'danger-6': 'var(--ant-danger-6)',
                'danger-7': 'var(--ant-danger-7)',
                'danger-8': 'var(--ant-danger-8)',
                'danger-9': 'var(--ant-danger-9)',

                // 固定颜色
                'fixed-0': 'var(--ant-fixed-0)',
                'fixed-F': 'var(--ant-fixed-F)',
            },
            boxShadow: {
                'ant': 'var(--ant-box-shadow)',
            },
            borderColor: {
                'description': 'var(--ant-description-border)',
            },
            backgroundColor: {
                'dark-bg': 'rgba(38, 38, 38, 1)',
            },
        },
    },
    plugins: [],
};

export default config;
