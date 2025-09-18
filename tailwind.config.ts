import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
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
