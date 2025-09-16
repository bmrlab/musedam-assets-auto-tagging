// import {
//   useServiceEnterpriseTagBatchAdd,
//   useServiceEnterpriseTagList
// } from '@/hooks/business/enterpriseTags/useEnterpriseTags';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ThreeTagList } from './ThreeTagList';
import { TagNode } from '../types';
import { batchCreateTags, BatchCreateTagData, checkExistingTags } from '../actions';

interface NameChildList {
  name: string;
  nameChildList?: NameChildList[];
}

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

const ManualCreateTips2Modal = ({
  visible,
  setVisible,
  onSuccess
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  onSuccess: () => void;
}) => {
  const t = useTranslations('TagsPage.ManualCreateTips2Modal');

  return (
    <Dialog open={visible} onOpenChange={setVisible}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('HereSTheTranslatedVersionFollo')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('ConfirmToUseTheNewTagSystemOnl')}
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVisible(false)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setVisible(false);
              onSuccess();
            }}
          >
            {t('ClearExistingTagsAndUseNewOnes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ManualCreateTipsModal = ({
  visible,
  setVisible,
  onSuccess
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  onSuccess: (addType: 1 | 2) => void;
}) => {
  const t = useTranslations('TagsPage.ManualCreateTipsModal');
  const [radioValue, setRadioValue] = useState<1 | 2>(2);

  return (
    <Dialog open={visible} onOpenChange={setVisible}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('CreateTagPrompt')}</DialogTitle>
        </DialogHeader>
        <div className="w-full h-auto flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">
            {t('ExistingTagDataFoundInTheSyste')}
          </div>
          <RadioGroup
            value={radioValue.toString()}
            onValueChange={(value) => setRadioValue(Number(value) as 1 | 2)}
            className="space-y-2 text-sm flex flex-col"
          >
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="2" id="merge" />
                <Label htmlFor="merge">{t('MergeIntoExistingTagSystem')}</Label>
              </div>
              <div className="text-xs text-muted-foreground pl-6">
                {t('RetainExistingTagsAndAddNewTag')}
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="1" id="clear" />
                <Label htmlFor="clear">{t('UnderstoodPleaseProvideTheText')}</Label>
              </div>
              <div className="text-xs text-muted-foreground pl-6">
                {t('ClearExistingTagsKeepOnlyTheNe')}
              </div>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVisible(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => {
              if (radioValue === 1) {
                onSuccess(radioValue);
              } else {
                setVisible(false);
                onSuccess(radioValue);
              }
            }}
          >
            {t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const CreateModal = ({
  visible,
  setVisible,
  refresh
}: {
  visible: boolean;
  setVisible: (x: boolean) => void;
  refresh?: () => void;
}) => {
  const t = useTranslations('TagsPage.ManualCreateModal');

  const [isManualTipsOpen, setIsManualTipsOpen] = useState(false);
  const [isManualTips2Open, setIsManualTips2Open] = useState(false);
  const [mode, setMode] = useState<'preview' | 'edit'>('edit');
  const [batchCreateText, inputBatchCreateText] = useState('');
  const [showTips, setShowTips] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [hasExistingTags, setHasExistingTags] = useState(false);
  const nameChildList: TTag[] = useMemo(() => {
    if (!batchCreateText) return [];
    const lines = batchCreateText.split('\n').filter((line) => line.trim());
    const result: TTag[] = [];
    let currentL1: TTag | null = null;
    let currentL2: TTag | null = null;
    for (const line of lines) {
      // 一级标签
      if (line.startsWith('# ') || (line.startsWith('#') && !line.startsWith('##'))) {
        const name = line.startsWith('# ') ? line.slice(2).trim() : line.slice(1).trim();
        // name 必须有值
        if (!name) continue;
        currentL1 = {
          name,
          nameChildList: []
        };
        currentL2 = null;
        result.push(currentL1);
      }
      // 二级标签
      else if (line.startsWith('## ') || (line.startsWith('##') && !line.startsWith('###'))) {
        if (!currentL1) continue;
        const name = line.startsWith('## ') ? line.slice(3).trim() : line.slice(2).trim();
        // name 必须有值
        if (!name) continue;
        currentL2 = {
          name,
          nameChildList: []
        };
        currentL1.nameChildList?.push(currentL2);
      }
      // 三级标签
      else if (line.trim() && !line.startsWith('#')) {
        if (!currentL2) continue;
        currentL2.nameChildList?.push({
          name: line.trim()
        });
      }
    }
    return result;
  }, [batchCreateText]);

  // const [activeTags, setActiveTags] = useState<{
  //   1: number | null;
  //   2: number | null;
  //   3: number | null;
  // }>({
  //   1: null,
  //   2: null,
  //   3: null
  // });

  // 预览模式下的选中状态
  const [previewSelectedLevel1Id, setPreviewSelectedLevel1Id] = useState<string | null>(null);
  const [previewSelectedLevel2Id, setPreviewSelectedLevel2Id] = useState<string | null>(null);
  const [previewSelectedLevel3Id, setPreviewSelectedLevel3Id] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setShowTips(true);
      inputBatchCreateText('');
      setPreviewSelectedLevel1Id(null);
      setPreviewSelectedLevel2Id(null);
      setPreviewSelectedLevel3Id(null);
    }
  }, [visible]);
  // 转换为 TagNode 格式用于预览
  const previewTagNodes = useMemo(() => convertToTagNodes(nameChildList), [nameChildList]);

  const list1 = nameChildList;
  // const total1 = list1.length;
  // const list2 = useMemo(() => {
  //   return typeof activeTags?.[1] === 'number' ? nameChildList[activeTags?.[1]]?.nameChildList || [] : [];
  // }, [nameChildList, activeTags?.[1]]);
  // const total2 = list2.length;
  // const list3 = useMemo(() => {
  //   return typeof activeTags?.[2] === 'number'
  //     ? typeof activeTags?.[1] === 'number'
  //       ? nameChildList[activeTags?.[1]]?.nameChildList?.[activeTags?.[2]]?.nameChildList || []
  //       : []
  //     : [];
  // }, [nameChildList, activeTags?.[1], activeTags?.[2]]);
  // const total3 = list3.length;

  // 预览模式下的数据
  const previewList1 = previewTagNodes;
  const previewList2 = useMemo(() => {
    if (!previewSelectedLevel1Id) return [];
    const selectedNode = previewTagNodes.find(node => node.tempId === previewSelectedLevel1Id);
    return selectedNode?.children || [];
  }, [previewTagNodes, previewSelectedLevel1Id]);
  const previewList3 = useMemo(() => {
    if (!previewSelectedLevel2Id) return [];
    const selectedNode = previewList2.find(node => node.tempId === previewSelectedLevel2Id);
    return selectedNode?.children || [];
  }, [previewList2, previewSelectedLevel2Id]);
  // 检查是否有现有标签
  useEffect(() => {
    if (visible) {
      const checkTags = async () => {
        try {
          const result = await checkExistingTags();
          if (result.success) {
            setHasExistingTags(result.data.hasExistingTags);
          }
        } catch (error) {
          console.error('Check existing tags error:', error);
        }
      };
      checkTags();
    }
  }, [visible]);

  const handleAddTags = async () => {
    if (hasExistingTags) {
      setIsManualTipsOpen(true);
    } else {
      handleManualTipsOk(2); // 默认合并模式
    }
  };

  const handleManualTipsOk = async (addType: 1 | 2) => {
    setIsManualTipsOpen(false);
    setIsCreating(true);

    try {
      // 将 NameChildList 转换为 BatchCreateTagData 格式
      const convertToBatchData = (data: NameChildList[]): BatchCreateTagData[] => {
        return data.map((item) => ({
          name: item.name,
          nameChildList: item.nameChildList ? convertToBatchData(item.nameChildList) : undefined,
        }));
      };

      const batchData = convertToBatchData(nameChildList);

      const result = await batchCreateTags(batchData, addType);

      if (result.success) {
        inputBatchCreateText('');
        refresh?.();
        toast.success(t('LabelsCreatedSuccessfully'));
        setVisible(false);
      } else {
        toast.error(result.message || '创建标签失败');
      }
    } catch (err: unknown) {
      console.error('Batch create tags error:', err);
      toast.error(err instanceof Error ? err.message : '创建标签时发生错误');
    } finally {
      setIsCreating(false);
    }
  };
  return (
    <>
      <Dialog open={visible} onOpenChange={setVisible}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t('CreateLabelsManually')}</DialogTitle>
          </DialogHeader>
          <div className="w-full h-[442px] flex flex-col gap-3">
            <div className="w-full flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {t('QuicklyCreateMultipleTagPathsW')}
              </div>
              <div className="h-[30px] w-auto rounded-md bg-muted p-0.5 flex items-center space-x-0.5">
                <div
                  className={cn(
                    'border border-solid rounded flex justify-center items-center px-2 cursor-pointer',
                    mode === 'preview'
                      ? 'border-border bg-background'
                      : 'border-transparent'
                  )}
                  onClick={() => setMode('preview')}
                >
                  <div
                    className={cn(
                      'text-[13px] leading-[22px] select-none',
                      mode === 'preview' ? 'font-medium text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {t('PreviewView')}
                  </div>
                </div>
                <div
                  className={cn(
                    'border border-solid rounded flex justify-center items-center px-2 cursor-pointer',
                    mode === 'edit'
                      ? 'border-border bg-background'
                      : 'border-transparent'
                  )}
                  onClick={() => setMode('edit')}
                >
                  <div
                    className={cn(
                      'text-[13px] leading-[22px] select-none',
                      mode === 'edit' ? 'font-medium text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {t('HereSTheTranslatedTextFollowin')}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 relative">
              <div className="absolute inset-0">
                <div className="relative w-full h-full">
                  {mode === 'edit' && (
                    <>
                      {showTips && !batchCreateText && (
                        <div className="absolute inset-0 px-4 py-2 text-muted-foreground text-sm leading-[22px] font-normal pointer-events-none">
                          <div>{t('PleaseCreateLabelsInTheFollowi')}</div>
                          <div>{t('FormatInstructions')}</div>
                          <div>{t('PrimaryTag')}</div>
                          <div>{t('SecondaryTags')}</div>
                          <div>{t('Label1')}</div>
                          <div>{t('Label2')}</div>
                          <div>{t('OrdinaryTextIsALevel3Tag')}</div>
                        </div>
                      )}
                      <Textarea
                        placeholder=""
                        onBlur={() => setShowTips(true)}
                        value={batchCreateText}
                        className={cn(
                          'relative h-full px-4 py-2',
                          batchCreateText?.length ? '' : 'bg-transparent'
                        )}
                        onChange={(e) => inputBatchCreateText(e.target.value || '')}
                      />
                    </>
                  )}
                  {mode === 'preview' && (
                    <ThreeTagList
                      list1={previewList1}
                      list2={previewList2}
                      list3={previewList3}
                      total1={previewList1.length}
                      total2={previewList2.length}
                      total3={previewList3.length}
                      selectedLevel1Id={previewSelectedLevel1Id}
                      selectedLevel2Id={previewSelectedLevel2Id}
                      selectedLevel3Id={previewSelectedLevel3Id}
                      onSelectLevel1={(nodeId) => {
                        setPreviewSelectedLevel1Id(nodeId);
                        setPreviewSelectedLevel2Id(null);
                        setPreviewSelectedLevel3Id(null);
                      }}
                      onSelectLevel2={(nodeId) => {
                        setPreviewSelectedLevel2Id(nodeId);
                        setPreviewSelectedLevel3Id(null);
                      }}
                      onSelectLevel3={(nodeId) => setPreviewSelectedLevel3Id(nodeId)}
                      showAdd={false}
                      showAiTags={false}
                      getNodeId={(node) => node.tempId || 'unknown'}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVisible(false)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!batchCreateText || !list1.length || isCreating}
              onClick={() => {
                handleAddTags();
              }}
            >
              {isCreating ? '创建中...' : t('CreateNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ManualCreateTipsModal
        visible={isManualTipsOpen}
        setVisible={setIsManualTipsOpen}
        onSuccess={(addType) => {
          if (addType === 1) {
            setIsManualTips2Open(true);
          } else {
            handleManualTipsOk(addType);
          }
        }}
      />
      <ManualCreateTips2Modal
        visible={isManualTips2Open}
        setVisible={setIsManualTips2Open}
        onSuccess={() => {
          setIsManualTipsOpen(false);
          handleManualTipsOk(1);
        }}
      />
    </>
  );
};
