import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";

interface TriggerTimingSectionProps {
    autoRealtimeTagging: boolean;
    manualTriggerTagging: boolean;
    scheduledTagging: boolean;
    onAutoRealtimeChange: (enabled: boolean) => void;
    onManualTriggerChange: (enabled: boolean) => void;
    onScheduledChange: (enabled: boolean) => void;
}

export function TriggerTimingSection({
    autoRealtimeTagging,
    manualTriggerTagging,
    scheduledTagging,
    onAutoRealtimeChange,
    onManualTriggerChange,
    onScheduledChange,
}: TriggerTimingSectionProps) {
    const t = useTranslations("Tagging.Settings.TriggerTiming");

    return (
        <div className="space-y-6">
            {/* 触发时机设置 */}
            <div className="bg-background border rounded-[6px]">
                <div className="px-4 py-3 border-b">
                    <h3 className="font-medium text-base">{t("title")}</h3>
                </div>
                <div className="p-6 space-y-6">
                    <div className="space-y-4">
                        {/* 自动实时打标 */}
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <h4 className="font-medium text-sm mb-1">{t("autoRealtimeTagging")}</h4>
                                <p className="text-xs text-basic-5">{t("autoRealtimeTaggingDesc")}</p>
                            </div>
                            <Switch
                                checked={autoRealtimeTagging}
                                onCheckedChange={onAutoRealtimeChange}
                            />
                        </div>

                        {/* 手动触发打标 */}
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <h4 className="font-medium text-sm mb-1">{t("manualTriggerTagging")}</h4>
                                <p className="text-xs text-basic-5">{t("manualTriggerTaggingDesc")}</p>
                            </div>
                            <Switch
                                checked={manualTriggerTagging}
                                onCheckedChange={onManualTriggerChange}
                            />
                        </div>

                        {/* 定时打标 */}
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <h4 className="font-medium text-sm mb-1">{t("scheduledTagging")}</h4>
                                <p className="text-xs text-basic-5">{t("scheduledTaggingDesc")}</p>
                            </div>
                            <Switch
                                checked={scheduledTagging}
                                onCheckedChange={onScheduledChange}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
