import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 格式化文件大小
 * @param sizeB 文件大小（字节）
 * @param isGoodOne 是否为特殊情况（1TB时显示为GB）
 * @returns 格式化后的文件大小字符串
 */
export function formatSize(sizeB = 0, isGoodOne = false) {
  if (!sizeB && sizeB !== 0) return "-";
  let size = "";
  const limit = sizeB || 0;
  if (limit < 1024) {
    size = limit.toFixed(2) + "B";
  } else if (limit < Math.pow(1024, 2)) {
    size = (limit / 1024).toFixed(2) + "KB";
  } else if (limit < Math.pow(1024, 3)) {
    size = (limit / Math.pow(1024, 2)).toFixed(2) + "MB";
  } else if (limit < Math.pow(1024, 4)) {
    size = (limit / Math.pow(1024, 3)).toFixed(2) + "G";
  } else {
    if (limit === Math.pow(1024, 4) && isGoodOne) {
      size = (limit / Math.pow(1024, 3)).toFixed(2) + "G";
    } else {
      size = (limit / Math.pow(1024, 4)).toFixed(2) + "T";
    }
  }

  const sizestr = String(size);
  const len = sizestr.indexOf(".");
  const dec = sizestr.substr(len + 1, 2);
  if (dec === "00") {
    return sizestr.substring(0, len) + sizestr.substr(len + 3, 2);
  }
  return sizestr;
}
