"use client";

import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useCallback, useEffect, useState } from "react";

export interface EnterpriseTagSetting {
  tagLevel: 3 | 4;
  showAiTag: 0 | 1;
}

export const DEFAULT_ENTERPRISE_TAG_SETTING: EnterpriseTagSetting = {
  tagLevel: 3,
  showAiTag: 1,
};

function normalize(raw?: Partial<EnterpriseTagSetting> | null): EnterpriseTagSetting {
  return {
    tagLevel: raw?.tagLevel === 4 ? 4 : 3,
    showAiTag: raw?.showAiTag === 0 ? 0 : 1,
  };
}

type Listener = (setting: EnterpriseTagSetting) => void;

let current = DEFAULT_ENTERPRISE_TAG_SETTING;
let loaded = false;
let inflight: Promise<EnterpriseTagSetting> | null = null;
const listeners = new Set<Listener>();

function publish(setting: EnterpriseTagSetting) {
  current = setting;
  loaded = true;
  listeners.forEach((listener) => listener(setting));
}

async function loadEnterpriseTagSetting() {
  if (loaded) return current;
  if (!inflight) {
    inflight = dispatchMuseDAMClientAction("get-tag-setting", {})
      .then((data) => normalize(data))
      .catch(() => DEFAULT_ENTERPRISE_TAG_SETTING)
      .finally(() => {
        inflight = null;
      });
  }
  const setting = await inflight;
  publish(setting);
  return setting;
}

export function useEnterpriseTagSetting() {
  const [setting, setSetting] = useState(current);

  useEffect(() => {
    listeners.add(setSetting);
    setSetting(current);
    if (!loaded) {
      void loadEnterpriseTagSetting();
    }
    return () => {
      listeners.delete(setSetting);
    };
  }, []);

  const save = useCallback(async (next: EnterpriseTagSetting) => {
    const saved = normalize(await dispatchMuseDAMClientAction("set-tag-setting", next));
    publish(saved);
    return saved;
  }, []);

  return { setting, save };
}
