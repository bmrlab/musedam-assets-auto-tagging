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
import { useEnterpriseTagSetting } from "../hooks/useEnterpriseTagSetting";
import { TagBatchEditor } from "./TagBatchEditor";
import { TagBatchFormatExample } from "./TagBatchFormatExample";

type TTag = NameChildList;

// 内部组件，使用 Context
const CreateModalInner = ({
  visible,
  setVisible,
  refresh,
  initialText = "",
  title,
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  refresh?: () => void;
  initialText?: string;
  title?: string;
}) => {
  const t = useTranslations("TagsPage.ManualCreateModal");
  const tGlobal = useTranslations("TagsPage");
  const { setting } = useEnterpriseTagSetting();

  const [mode, setMode] = useState<"preview" | "edit">("edit");
  const [batchCreateText, inputBatchCreateText] = useState("");

  // 使用提取的 Hook
  const { isCreating, handleAddTags } = useBatchCreateTagsContext();
  const nameChildList: TTag[] = useMemo(() => {
    return parseTextToNameChildList(batchCreateText, setting.tagLevel);
  }, [batchCreateText, setting.tagLevel]);

  useEffect(() => {
    if (!visible) {
      inputBatchCreateText("");
      setMode("edit");
      return;
    }
    if (initialText) {
      inputBatchCreateText(initialText);
      setMode("preview");
    }
  }, [visible, initialText]);
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
            <DialogTitle>{title || t("CreateLabelsManually")}</DialogTitle>
          </DialogHeader>
          <div className="w-full h-[442px] flex flex-col gap-3">
            <div className="text-sm text-basic-5">{t("QuicklyCreateMultipleTagPathsW")}</div>
            <TagBatchEditor
              value={batchCreateText}
              onChange={(v) => inputBatchCreateText(v)}
              mode={mode}
              onModeChange={setMode}
              placeholderContent={<TagBatchFormatExample />}
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
  initialText = "",
  title,
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  refresh?: () => void;
  initialText?: string;
  title?: string;
}) => {
  return (
    <BatchCreateTagsProvider onSuccess={refresh} onClose={() => setVisible(false)}>
      <CreateModalInner
        visible={visible}
        setVisible={setVisible}
        refresh={refresh}
        initialText={initialText}
        title={title}
      />
    </BatchCreateTagsProvider>
  );
};
