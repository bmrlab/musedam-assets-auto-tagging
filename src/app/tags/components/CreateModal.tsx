// import {
//   useServiceEnterpriseTagBatchAdd,
//   useServiceEnterpriseTagList
// } from '@/hooks/business/enterpriseTags/useEnterpriseTags';
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BatchCreateTagsProvider,
  NameChildList,
  parseTextToNameChildList,
  useBatchCreateTagsContext,
} from "../context/BatchCreateTagsContext";
import { TagNode } from "../types";
import { TagBatchEditor } from "./TagBatchEditor";

type TTag = NameChildList;

// 将 NameChildList 转换为 TagNode 格式
const convertToTagNodes = (nameChildList: NameChildList[]): TagNode[] => {
  return nameChildList.map((item, index) => ({
    id: undefined,
    slug: null,
    name: item.name,
    originalName: item.name,
    children: item.nameChildList ? convertToTagNodes(item.nameChildList) : [],
    tempId: `preview_${index}`,
  }));
};

// 内部组件，使用 Context
const CreateModalInner = ({
  visible,
  setVisible,
  refresh,
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  refresh?: () => void;
}) => {
  const t = useTranslations("TagsPage.ManualCreateModal");
  const tGlobal = useTranslations("TagsPage");

  const [mode, setMode] = useState<"preview" | "edit">("edit");
  const [batchCreateText, inputBatchCreateText] = useState("");

  // 使用提取的 Hook
  const { isCreating, handleAddTags } = useBatchCreateTagsContext();
  const nameChildList: TTag[] = useMemo(() => {
    return parseTextToNameChildList(batchCreateText);
  }, [batchCreateText]);

  useEffect(() => {
    if (!visible) {
      inputBatchCreateText("");
    }
  }, [visible]);
  // 转换为 TagNode 格式用于预览

  const list1 = nameChildList;

  const handleCreateTags = async () => {
    await handleAddTags(nameChildList);
  };

  return (
    <>
      <Dialog open={visible} onOpenChange={setVisible}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t("CreateLabelsManually")}</DialogTitle>
          </DialogHeader>
          <div className="w-full h-[442px] flex flex-col gap-3">
            <div className="text-sm text-basic-5">{t("QuicklyCreateMultipleTagPathsW")}</div>
            <TagBatchEditor
              value={batchCreateText}
              onChange={(v) => inputBatchCreateText(v)}
              mode={mode}
              onModeChange={setMode}
              placeholderContent={
                <div>
                  <div>{t("PleaseCreateLabelsInTheFollowi")}</div>
                  <div>{t("FormatInstructions")}</div>
                  <div>{t("PrimaryTag")}</div>
                  <div>{t("SecondaryTags")}</div>
                  <div>{t("Label1")}</div>
                  <div>{t("Label2")}</div>
                  <div>{t("OrdinaryTextIsALevel3Tag")}</div>
                </div>
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVisible(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!batchCreateText || !list1.length || isCreating}
              onClick={handleCreateTags}
            >
              {isCreating ? tGlobal("saving") : t("CreateNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// 主组件，提供 Context
export const CreateModal = ({
  visible,
  setVisible,
  refresh,
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  refresh?: () => void;
}) => {
  return (
    <BatchCreateTagsProvider onSuccess={refresh} onClose={() => setVisible(false)}>
      <CreateModalInner visible={visible} setVisible={setVisible} refresh={refresh} />
    </BatchCreateTagsProvider>
  );
};
