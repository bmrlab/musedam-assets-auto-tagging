/**
 * 设置 localStorage 值并派发自定义事件的工具函数
 * 用于 usehooks-ts 的 useLocalStorage hook 在组件间同步状态
 * @param key - localStorage 键名
 * @param value - 要存储的值（将被 JSON 序列化）
 */
export function setLocalStorageWithEvent<T>(key: string, value: T): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("local-storage", { detail: { key } }));
}

/**
 * 自定义 Hook，提供设置 localStorage 并派发事件的函数
 * @param key - localStorage 键名
 * @returns 用于设置 localStorage 值的函数
 */
export function useSetLocalStorage<T>(key: string) {
  return (value: T) => {
    setLocalStorageWithEvent(key, value);
  };
}
