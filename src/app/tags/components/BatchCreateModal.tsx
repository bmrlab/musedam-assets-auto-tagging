"use client";

import { Tag } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface BatchCreateModalProps {
  visible: boolean;
  setVisible: (visible: boolean) => void;
  onSelectAiCreate: () => void;
  onSelectManualCreate: () => void;
}

export const BatchCreateModal = ({
  visible,
  setVisible,
  onSelectAiCreate,
  onSelectManualCreate,
}: BatchCreateModalProps) => {
  const t = useTranslations("TagsPage");
  const [selectedOption, setSelectedOption] = useState<"ai" | "manual">("ai");

  const handleConfirm = () => {
    if (selectedOption === "ai") {
      onSelectAiCreate();
    } else {
      onSelectManualCreate();
    }
    setVisible(false);
  };

  return (
    <Dialog open={visible} onOpenChange={setVisible}>
      <DialogContent className="w-[440px] max-w-[100%] gap-0">
        <DialogHeader className="pb-4">
          <DialogTitle>{t("batchCreate")}</DialogTitle>
        </DialogHeader>

        <div>
          <p className="text-sm text-basic-7 mb-3">
            {t("selectCreateMethod", { default: "请选择创建方式:" })}
          </p>

          <RadioGroup
            value={selectedOption}
            onValueChange={(value) => setSelectedOption(value as "ai" | "manual")}
          >
            <div className="space-y-4">
              {(
                [
                  {
                    key: "ai",
                    label: t("aiCreateLabel", { default: "AI 智能创建标签" }),
                    description: t("aiCreateDesc", {
                      default: "基于行业特征, AI 自动生成专业标签模板, 快速搭建分类体系",
                    }),
                    isRecommended: true,
                  },
                  {
                    key: "manual",
                    label: t("manualCreateLabel", { default: "手动创建标签" }),
                    description: t("manualCreateDesc", {
                      default: "结合企业独有的业务场景和知识沉淀, 打造专属标签架构",
                    }),
                    isRecommended: false,
                  },
                ] as const
              ).map(({ key, label, description, isRecommended }) => {
                return (
                  <Card
                    key={key}
                    className={`cursor-pointer py-4 transition-all ease-in-out duration-300 ${
                      selectedOption === key
                        ? "border-primary-6 bg-primary-1 ring-1 ring-primary-6"
                        : "border-basic-4 hover:border-primary-6"
                    }`}
                    onClick={() => setSelectedOption(key)}
                  >
                    <CardContent className="px-4">
                      <div className="flex  flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value={key} />
                          <h3 className="font-medium text-basic-8 text-sm">{label}</h3>
                          {isRecommended && (
                            <Tag variant="purple">{t("recommended", { default: "推荐" })}</Tag>
                          )}
                        </div>
                        <p className="text-xs text-basic-5 mt-1 ml-6">{description}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </RadioGroup>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button variant="outline" onClick={() => setVisible(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm}>{t("confirmSync", { default: "确认" })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
