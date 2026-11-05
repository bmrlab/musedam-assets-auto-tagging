import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import messages from "../../src/app/(tagging)/messages/zh-CN.json";
import { MetadataResults } from "../../src/app/(tagging)/tagging/components/MetadataResults";
import { MetadataReviewPanel } from "../../src/app/(tagging)/tagging/review/MetadataReviewPanel";
import { GlobalSettingsSection } from "../../src/app/(tagging)/tagging/settings/components/GlobalSettingsSection";
import "../../src/app/globals.css";
import { prediction } from "./actions";
function App() {
  const [dark, setDark] = useState(true);
  const [tags, setTags] = useState(true);
  const [metadata, setMetadata] = useState(true);
  return (
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <div className={dark ? "dark" : ""}>
        <main className="flex min-h-screen flex-col gap-6 bg-background p-6 text-foreground">
          <header className="flex items-center justify-between">
            <h1 className="text-[22px] font-semibold">元数据自动填写 · 本地验收样例</h1>
            <button className="rounded-md border px-4 py-2" onClick={() => setDark(!dark)}>
              切换主题
            </button>
          </header>
          <p className="text-sm text-basic-6">使用真实组件、模拟审核数据；不连接远端服务。</p>
          <GlobalSettingsSection
            isTaggingEnabled={tags}
            onTaggingEnabledChange={setTags}
            metadataAvailable
            isMetadataEnabled={metadata}
            onMetadataEnabledChange={setMetadata}
          />
          <MetadataResults
            predictions={[
              prediction,
              {
                ...prediction,
                fieldId: "bool",
                fieldName: "含人物",
                confidence: 0.5,
                score: 50,
                optionIds: undefined,
                checked: false,
                labels: [],
                effective: false,
              },
            ]}
          />
          <section className="flex h-[600px] flex-col">
            <MetadataReviewPanel />
          </section>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
