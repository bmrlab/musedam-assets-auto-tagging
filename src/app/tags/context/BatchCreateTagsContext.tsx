"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spin } from "@/components/ui/spin";
import { useTranslations } from "next-intl";
import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { toast } from "sonner";
import { BatchCreateTagData, batchCreateTags, checkExistingTags } from "../actions";

export interface NameChildList {
  name: string;
  nameChildList?: NameChildList[];
}

// 解析文本为 NameChildList 格式的函数
export const parseTextToNameChildList = (text: string): NameChildList[] => {
  if (!text.trim()) return [];

  const lines = text.split("\n").filter((line) => line.trim());
  const result: NameChildList[] = [];
  let currentL1: NameChildList | null = null;
  let currentL2: NameChildList | null = null;

  for (const line of lines) {
    // 一级标签
    if (line.startsWith("# ") || (line.startsWith("#") && !line.startsWith("##"))) {
      const name = line.startsWith("# ") ? line.slice(2).trim() : line.slice(1).trim();
      // name 必须有值
      if (!name) continue;
      currentL1 = {
        name,
        nameChildList: [],
      };
      currentL2 = null;
      result.push(currentL1);
    }
    // 二级标签
    else if (line.startsWith("## ") || (line.startsWith("##") && !line.startsWith("###"))) {
      if (!currentL1) continue;
      const name = line.startsWith("## ") ? line.slice(3).trim() : line.slice(2).trim();
      // name 必须有值
      if (!name) continue;
      currentL2 = {
        name,
        nameChildList: [],
      };
      currentL1.nameChildList?.push(currentL2);
    }
    // 三级标签
    else if (line.trim() && !line.startsWith("#")) {
      if (!currentL2) continue;
      currentL2.nameChildList?.push({
        name: line.trim(),
      });
    }
  }
  return result;
};

interface BatchCreateTagsContextType {
  // 状态
  isCreating: boolean;

  // 模态框状态
  isManualTipsOpen: boolean;
  isManualTips2Open: boolean;

  // 数据
  pendingNameChildList: NameChildList[] | null;

  // 方法
  handleAddTags: (nameChildList: NameChildList[]) => Promise<void>;
  handleManualTipsOk: (addType: 1 | 2, nameChildList: NameChildList[]) => Promise<void>;

  // 模态框方法
  showManualTips: (nameChildList: NameChildList[]) => void;
  showManualTips2: () => void;
  closeManualTips: () => void;
  closeManualTips2: () => void;
  handleManualTipsConfirm: (addType: 1 | 2) => void;
  handleManualTips2Confirm: () => void;
}

const BatchCreateTagsContext = createContext<BatchCreateTagsContextType | undefined>(undefined);

export const useBatchCreateTagsContext = () => {
  const context = useContext(BatchCreateTagsContext);
  if (!context) {
    throw new Error("useBatchCreateTagsContext must be used within BatchCreateTagsProvider");
  }
  return context;
};

interface BatchCreateTagsProviderProps {
  children: ReactNode;
  onSuccess?: () => void;
  onClose?: () => void;
  translationKey?: "TagsPage.ManualCreateModal";
}

export const BatchCreateTagsProvider = ({
  children,
  onSuccess,
  onClose,
  translationKey = "TagsPage.ManualCreateModal",
}: BatchCreateTagsProviderProps) => {
  const t = useTranslations(translationKey);

  const [isCreating, setIsCreating] = useState(false);

  // 模态框状态
  const [isManualTipsOpen, setIsManualTipsOpen] = useState(false);
  const [isManualTips2Open, setIsManualTips2Open] = useState(false);
  const [pendingNameChildList, setPendingNameChildList] = useState<NameChildList[] | null>(null);

  // 将 NameChildList 转换为 BatchCreateTagData 格式
  const convertToBatchData = useCallback((data: NameChildList[]): BatchCreateTagData[] => {
    return data.map((item) => ({
      name: item.name,
      nameChildList: item.nameChildList ? convertToBatchData(item.nameChildList) : undefined,
    }));
  }, []);

  // 处理标签创建的主要逻辑
  const handleManualTipsOk = useCallback(
    async (addType: 1 | 2, nameChildList: NameChildList[]) => {
      setIsCreating(true);

      try {
        const batchData = convertToBatchData(nameChildList);
        const result = await batchCreateTags(batchData, addType);

        if (result.success) {
          onSuccess?.();
          onClose?.();
        } else {
          toast.error(result.message || "创建标签失败");
        }
      } catch (err: unknown) {
        console.error("Batch create tags error:", err);
        toast.error(err instanceof Error ? err.message : "创建标签时发生错误");
      } finally {
        setIsCreating(false);
      }
    },
    [convertToBatchData, onSuccess, onClose, t],
  );

  // 模态框方法
  const showManualTips = useCallback((nameChildList: NameChildList[]) => {
    setPendingNameChildList(nameChildList);
    setIsManualTipsOpen(true);
  }, []);

  // 处理添加标签的入口逻辑
  const handleAddTags = useCallback(
    async (nameChildList: NameChildList[]) => {
      let hasExistingTags = false;
      const hasExistingTagsResult = await checkExistingTags();
      if (hasExistingTagsResult.success) {
        hasExistingTags = hasExistingTagsResult.data.hasExistingTags;
      }
      if (hasExistingTags) {
        showManualTips(nameChildList);
      } else {
        await handleManualTipsOk(2, nameChildList); // 默认合并模式
      }
    },
    [showManualTips, handleManualTipsOk],
  );

  const showManualTips2 = () => {
    setIsManualTips2Open(true);
  };

  const closeManualTips = () => {
    setIsManualTipsOpen(false);
    setPendingNameChildList(null);
  };

  const closeManualTips2 = () => {
    setIsManualTips2Open(false);
  };

  const handleManualTipsConfirm = async (addType: 1 | 2) => {
    if (!pendingNameChildList) return;

    if (addType === 1) {
      showManualTips2();
    } else {
      await handleManualTipsOk(addType, pendingNameChildList);
      closeManualTips();
    }
  };

  const handleManualTips2Confirm = async () => {
    if (!pendingNameChildList) return;

    await handleManualTipsOk(1, pendingNameChildList);
    closeManualTips2();
    closeManualTips();
  };

  const value: BatchCreateTagsContextType = {
    // 状态
    isCreating,

    // 模态框状态
    isManualTipsOpen,
    isManualTips2Open,
    pendingNameChildList,

    handleAddTags,
    handleManualTipsOk,

    // 模态框方法
    showManualTips,
    showManualTips2,
    closeManualTips,
    closeManualTips2,
    handleManualTipsConfirm,
    handleManualTips2Confirm,
  };

  return (
    <BatchCreateTagsContext.Provider value={value}>
      {children}
      <BatchCreateModals />
    </BatchCreateTagsContext.Provider>
  );
};

// 模态框组件
const ManualCreateTipsModal = () => {
  const t = useTranslations("TagsPage.ManualCreateTipsModal");
  const { isManualTipsOpen, closeManualTips, handleManualTipsConfirm, isCreating } =
    useBatchCreateTagsContext();
  const [radioValue, setRadioValue] = useState<1 | 2>(2);

  return (
    <Dialog open={isManualTipsOpen} onOpenChange={closeManualTips}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t("CreateTagPrompt")}</DialogTitle>
        </DialogHeader>
        <div className="w-full h-auto flex flex-col gap-4">
          <div className="text-sm text-basic-5">{t("ExistingTagDataFoundInTheSyste")}</div>
          <RadioGroup
            value={radioValue.toString()}
            onValueChange={(value) => setRadioValue(Number(value) as 1 | 2)}
            className="space-y-2 text-sm flex flex-col"
          >
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="2" id="merge" />
                <Label htmlFor="merge">{t("MergeIntoExistingTagSystem")}</Label>
              </div>
              <div className="text-xs text-basic-5 pl-6">{t("RetainExistingTagsAndAddNewTag")}</div>
            </div>
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="1" id="clear" />
                <Label htmlFor="clear">{t("UnderstoodPleaseProvideTheText")}</Label>
              </div>
              <div className="text-xs text-basic-5 pl-6">{t("ClearExistingTagsKeepOnlyTheNe")}</div>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeManualTips}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={() => {
              handleManualTipsConfirm(radioValue);
            }}
            disabled={isCreating}
          >
            {isCreating && <Spin />}
            {t("Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ManualCreateTips2Modal = () => {
  const t = useTranslations("TagsPage.ManualCreateTips2Modal");
  const { isManualTips2Open, closeManualTips2, handleManualTips2Confirm } =
    useBatchCreateTagsContext();

  return (
    <Dialog open={isManualTips2Open} onOpenChange={closeManualTips2}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t("HereSTheTranslatedVersionFollo")}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{t("ConfirmToUseTheNewTagSystemOnl")}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={closeManualTips2}>
            {t("Cancel")}
          </Button>
          <Button variant="destructive" onClick={handleManualTips2Confirm}>
            {t("ClearExistingTagsAndUseNewOnes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// 组合组件，包含所有相关的模态框
const BatchCreateModals = () => {
  return (
    <>
      <ManualCreateTipsModal />
      <ManualCreateTips2Modal />
    </>
  );
};
