#!/bin/sh
# Web 容器启动脚本：V8 堆上限按容器内存 limit 自适应（约 65%），其余留给 Next.js 基础 RSS、
# sharp 原生内存与系统开销。镜像默认的 640MB 是按 1Gi 容器定的，跑在 2Gi 的容器上会过早撞到
# 堆上限直接崩溃（JavaScript heap out of memory）。部署层显式设置了 NODE_OPTIONS 时不覆盖。
DEFAULT_NODE_OPTIONS="--max-old-space-size=640"

if [ "$NODE_OPTIONS" = "$DEFAULT_NODE_OPTIONS" ]; then
  limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
  case "$limit" in
    "" | max | *[!0-9]*) ;;
    *)
      heap_mb=$((limit / 1024 / 1024 * 65 / 100))
      # 低于默认值（limit < ~1Gi）或大得离谱（cgroup v1 的"无限制"）时保持默认
      if [ "$heap_mb" -ge 640 ] && [ "$heap_mb" -le 16384 ]; then
        export NODE_OPTIONS="--max-old-space-size=$heap_mb"
      fi
      ;;
  esac
fi

echo "[start-web] NODE_OPTIONS=$NODE_OPTIONS"
export HOSTNAME="0.0.0.0"
exec node server.js
