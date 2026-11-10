import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import messages from "../../src/app/(tagging)/messages/zh-CN.json";
import { MetadataResults } from "../../src/app/(tagging)/tagging/components/MetadataResults";
import { MetadataInlineReview } from "../../src/app/(tagging)/tagging/review/MetadataInlineReview";
import { MetadataReviewPanel } from "../../src/app/(tagging)/tagging/review/MetadataReviewPanel";
import { AIRecognitionSection } from "../../src/app/(tagging)/tagging/settings/components/AIRecognitionSection";
import { GlobalSettingsSection } from "../../src/app/(tagging)/tagging/settings/components/GlobalSettingsSection";
import { MatchingStrategySection } from "../../src/app/(tagging)/tagging/settings/components/MatchingStrategySection";
import { TaggingModeSection } from "../../src/app/(tagging)/tagging/settings/components/TaggingModeSection";
import { DEFAULT_TAGGING_SETTINGS } from "../../src/app/(tagging)/types";
import "../../src/app/globals.css";
import { Button } from "../../src/components/ui/button";
import { prediction } from "./actions";
function App() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  const [tab, setTab] = useState("设置");
  const [tags, setTags] = useState(true);
  const [metadata, setMetadata] = useState(true);
  const [settings, setSettings] = useState(DEFAULT_TAGGING_SETTINGS);
  return (
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <div className={dark ? "dark" : ""}>
        <main className="flex min-h-screen flex-col gap-6 bg-basic-1 p-6 text-foreground">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-[22px] font-semibold leading-8">AI 自动打标引擎</h1>
              <p className="text-[13px] text-basic-5 dark:text-basic-6">
                本地 UI 验收 · 真实业务组件 / 模拟素材数据
              </p>
            </div>
            <Button variant="outline" onClick={() => setDark(!dark)}>
              切换主题
            </Button>
          </header>
          <nav className="flex gap-6 border-b" aria-label="预览页面">
            {["设置", "审核", "匹配测试"].map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                aria-current={tab === item ? "page" : undefined}
                className={`border-b-2 pb-3 text-sm ${tab === item ? "border-primary-6 text-primary-6" : "border-transparent text-basic-5 dark:text-basic-6"}`}
              >
                {item}
              </button>
            ))}
          </nav>
          {tab === "设置" && (
            <div className="flex flex-col gap-4">
              <GlobalSettingsSection
                isTaggingEnabled={tags}
                onTaggingEnabledChange={setTags}
                metadataAvailable
                isMetadataEnabled={metadata}
                onMetadataEnabledChange={setMetadata}
              />
              <TaggingModeSection
                metadataAvailable
                taggingMode={settings.taggingMode}
                onTaggingModeChange={(taggingMode) => setSettings({ ...settings, taggingMode })}
              />
              <AIRecognitionSection
                imageMode={settings.featureImageMode ?? false}
                onImageModeChange={(featureImageMode) => setSettings({ ...settings, featureImageMode })}
                recognitionAccuracy={settings.recognitionAccuracy}
                onRecognitionAccuracyChange={(recognitionAccuracy) =>
                  setSettings({ ...settings, recognitionAccuracy })
                }
              />
              <MatchingStrategySection
                matchingSources={settings.matchingSources}
                sourceWeights={settings.sourceWeights}
                onSourceChange={(source, value) =>
                  setSettings({
                    ...settings,
                    matchingSources: { ...settings.matchingSources, [source]: value },
                  })
                }
                onWeightChange={(source, value) =>
                  setSettings({
                    ...settings,
                    sourceWeights: { ...settings.sourceWeights, [source]: value },
                  })
                }
              />
              <p className="text-[13px] text-basic-5 dark:text-basic-6">
                {messages.Tagging.Metadata.sharedModeHint}
              </p>
            </div>
          )}
          {tab === "匹配测试" && (
            <section className="flex flex-col gap-4 rounded-lg border bg-background p-6">
              <h2 className="text-lg font-semibold">AI 匹配结果</h2>
              <div className="flex flex-col gap-1 border-b pb-4">
                <span className="text-sm font-medium">精华液主视觉.jpg</span>
                <span className="text-[13px] text-basic-5 dark:text-basic-6">
                  JPG · 2.5 MB · 测试数据
                </span>
              </div>
              <MetadataResults
                testResult
                predictions={[
                  prediction,
                  {
                    ...prediction,
                    fieldId: "channel",
                    fieldName: "投放渠道",
                    labels: ["天猫", "小红书"],
                    score: 76,
                    effective: false,
                  },
                ]}
              />
            </section>
          )}
          {tab === "审核" && (
            <div className="flex flex-col gap-6">
              <article className="flex flex-col gap-4 rounded-lg border bg-background p-5">
                <h2 className="text-sm font-semibold">精华液主视觉.jpg · 全部内容中的字段区</h2>
                <MetadataInlineReview
                  assetObjectId={1}
                  rows={[{ id: 1, status: "pending", prediction }]}
                />
              </article>
              <section className="flex min-h-[500px] flex-col gap-3">
                <h2 className="text-sm font-semibold">仅字段</h2>
                <MetadataReviewPanel />
              </section>
            </div>
          )}
          <Toaster />
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
