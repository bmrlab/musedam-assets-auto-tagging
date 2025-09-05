#!/bin/bash

# 自动检测系统架构并下载对应的 frpc 客户端

set -e

# 检测操作系统和架构
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
    x86_64)
        ARCH="amd64"
        ;;
    arm64|aarch64)
        ARCH="arm64"
        ;;
    *)
        echo "不支持的架构: $ARCH"
        exit 1
        ;;
esac

# frp 版本
VERSION="0.52.3"
FILENAME="frp_${VERSION}_${OS}_${ARCH}"

echo "检测到系统: ${OS}_${ARCH}"
echo "开始下载 frpc 客户端..."

# 下载并解压
wget "https://github.com/fatedier/frp/releases/download/v${VERSION}/${FILENAME}.tar.gz"
tar -xzf "${FILENAME}.tar.gz"
cp "${FILENAME}/frpc" .
chmod +x frpc

# 清理下载的文件
rm -rf "${FILENAME}.tar.gz" "${FILENAME}"

echo "✅ frpc 客户端安装完成！"
echo "现在可以运行: ./frpc -c ./frpc.toml"
