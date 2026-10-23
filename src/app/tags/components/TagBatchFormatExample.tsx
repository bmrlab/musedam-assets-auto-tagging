"use client";

import { useTranslations } from "next-intl";
import { useEnterpriseTagSetting } from "../hooks/useEnterpriseTagSetting";

/**
 * 批量创建的格式示例。四层开启时展示 ###，并标明其下普通文本是四级标签。
 */
export function TagBatchFormatExample({
  showIntro = true,
  showDescriptions = true,
}: {
  showIntro?: boolean;
  showDescriptions?: boolean;
}) {
  const t = useTranslations("TagsPage.ManualCreateModal");
  const { setting } = useEnterpriseTagSetting();
  const fourLevels = setting.tagLevel >= 4;

  return (
    <div className="space-y-1 text-start">
      {showIntro && <div>{t("PleaseCreateLabelsInTheFollowi")}</div>}
      <div className="font-medium">{t("FormatInstructions")}</div>
      <div className="flex items-start">
        <span className="mr-2 whitespace-nowrap">{t("PrimaryTag")}</span>
        {showDescriptions && (
          <span className="text-[#52C41A] text-start">{t("PrimaryTagDescription")}</span>
        )}
      </div>
      <div className="flex items-start">
        <span className="mr-2 whitespace-nowrap">{t("SecondaryTags")}</span>
        {showDescriptions && (
          <span className="text-[#1890FF] text-start">{t("SecondaryTagDescription")}</span>
        )}
      </div>
      {fourLevels && (
        <div className="flex items-start">
          <span className="mr-2 whitespace-nowrap">{t("TertiaryTags")}</span>
          {showDescriptions && (
            <span className="text-[#722ED1] text-start">{t("TertiaryTagDescription")}</span>
          )}
        </div>
      )}
      <div className={fourLevels ? "pl-4" : undefined}>
        <div className="flex items-start gap-2">
          <span className="whitespace-nowrap">{t("Label1")}</span>
          {showDescriptions && <span className="text-[#FAAD14]">{t("LabelDescription")}</span>}
        </div>
        <div>{t("Label2")}</div>
      </div>
      <div>{t("OrdinaryTextIsLeafTag")}</div>
    </div>
  );
}
