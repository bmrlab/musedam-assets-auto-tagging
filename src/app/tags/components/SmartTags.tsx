import { Input } from "@/components/ui/input";
import { useCallback, useEffect, useRef, useState } from "react";
import { isNumber } from "util";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit2Icon, Trash2Icon } from "lucide-react";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { TagRecord } from "../types";

export const SmartTagsContent = () => {
    const [listInfo, setListInfo] = useState<{
        tags: TagRecord[],
        total: number,
        isLoading: boolean,
        current: number,
        pageSize: number
    }>()

    const [hasMore, setHasMore] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const loadMoreRef = useRef<HTMLDivElement>(null)

    const getList = async (pageNum: number = 1, isLoadMore: boolean = false) => {
        if (isLoadMore) {
            setLoadingMore(true)
        } else {
            setListInfo(prev => prev ? { ...prev, isLoading: true } : undefined)
        }

        const res = await dispatchMuseDAMClientAction("get-smart-tags-list", {
            pageNum,
            pageSize: 50
        });

        if (isLoadMore && listInfo) {
            // 加载更多时追加数据
            setListInfo(prev => prev ? {
                ...prev,
                tags: [...prev.tags, ...res.tags],
                current: res.current,
                isLoading: false
            } : res)
        } else {
            // 首次加载或刷新
            setListInfo(res)
        }

        setHasMore(res.tags.length === 50 && res.current * res.pageSize < res.total)
        setLoadingMore(false)
    }

    useEffect(() => {
        getList()
    }, [])

    // 使用 Intersection Observer 监听加载更多
    useEffect(() => {
        if (!hasMore || loadingMore || !listInfo) return

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries
                if (entry.isIntersecting) {
                    const nextPage = listInfo.current + 1
                    getList(nextPage, true)
                }
            },
            {
                root: containerRef.current,
                rootMargin: '100px', // 提前100px触发加载
                threshold: 0.1
            }
        )

        const loadMoreElement = loadMoreRef.current
        if (loadMoreElement) {
            observer.observe(loadMoreElement)
        }

        return () => {
            if (loadMoreElement) {
                observer.unobserve(loadMoreElement)
            }
        }
    }, [hasMore, loadingMore, listInfo, getList])

    const [selectedTag, setSelectedTag] = useState<TagRecord | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean;
        x: number;
        y: number;
    }>({ visible: false, x: 0, y: 0 });

    const showContextMenu = useCallback(
        (e: React.MouseEvent, tag: TagRecord) => {
            e.preventDefault();
            setSelectedTag(tag);
            setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
            });
        },
        []
    );

    const hideContextMenu = useCallback(() => {
        setContextMenu({ visible: false, x: 0, y: 0 });
    }, []);

    useEffect(() => {
        if (!contextMenu.visible) return;

        const handleClickOutside = () => {
            hideContextMenu();
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        document.addEventListener('click', handleClickOutside);
        document.addEventListener('contextmenu', handleContextMenu);

        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('contextmenu', handleContextMenu);
        };
    }, [contextMenu.visible, hideContextMenu]);
    const editTagRef = useRef<HTMLDivElement>(null);
    // const editTagSize = useSize(editTagRef);
    const [isEditTag, setIsEditTag] = useState<TagRecord | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [inputValue, setInputValue] = useState('');

    const handleRename = () => {
        hideContextMenu();
        setIsEditTag(selectedTag);
        setInputValue(selectedTag?.name || '');
        setTimeout(() => {
            inputRef.current?.select();
        }, 50);
    };


    const handleDelete = async (tag: TagRecord,) => {
        const res = await dispatchMuseDAMClientAction("delete-smart-tag", { tag })
        if (res.success) {
            setSelectedTag(null)
            // 更新当前列表状态
            setListInfo(prev => prev ? {
                ...prev,
                tags: prev.tags.filter(t => t.id !== tag.id),
                total: prev.total - 1
            } : prev)
            // 重新计算是否还有更多数据
            setHasMore(prev => {
                if (!listInfo) return prev
                const remainingCount = listInfo.total - 1
                return remainingCount > listInfo.tags.length - 1
            })
        }
    };

    const changeAiTag = async (tagId: number, newName: string) => {
        // 如果名字没有变化，直接退出编辑状态
        if (selectedTag?.name === newName) {
            setSelectedTag(null)
            setIsEditTag(null)
            return
        }
        const res = await dispatchMuseDAMClientAction("rename-smart-tag", {
            tagId,
            newName
        })
        setSelectedTag(null)
        setIsEditTag(null)
        if (res.success) {
            // 更新当前列表状态
            setListInfo(prev => prev ? {
                ...prev,
                tags: prev.tags.map(t => t.id === tagId ? { ...t, name: newName } : t)
            } : prev)
        }
    }

    return (
        <div className="flex flex-col w-full h-full overflow-y-scroll p-5 gap-3">
            <div className="flex items-center gap-[7px]">
                <div className="text-base leading-4 text-[var(--ant-basic-7)] font-semibold">
                    智能标签
                </div>
                <div className="w-auto h-5 px-2 rounded-full bg-[var(--ant-basic-3)] text-[12px] leading-5 text-[var(--ant-basic6)]">
                    {listInfo?.total}
                </div>
            </div>
            <div
                ref={containerRef}
                className="flex gap-2.5 flex-wrap flex-1 "
            >
                {listInfo?.tags.map((tag, index) => {
                    if (isEditTag?.id === tag?.id) {
                        return (
                            <Input
                                key={tag.id}
                                ref={inputRef}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                className="h-[22px] text-xs leading-4 px-2 w-auto min-w-[80px] max-w-[250px]"
                                style={{
                                    width: `${Math.max(inputValue.length * 10 + 20, 80)}px`
                                }}
                                onBlur={() => {
                                    changeAiTag(tag.id, inputValue);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        changeAiTag(tag.id, inputValue);
                                    }
                                }}
                            />
                        );
                    } else {
                        return (
                            <div
                                key={index}
                                className="flex-shrink-0 gap-1 h-6 flex items-center bg-[var(--ant-basic-1)] text-[var(--ant-basic-7)] rounded border border-solid border-[var(--ant-basic-3)] px-2 cursor-pointer hover:bg-[var(--ant-primary-1)] hover:border-[var(--ant-primary-5)] hover:text-[var(--ant-primary-5)] transition-all duration-300"
                                onContextMenu={(e) => showContextMenu(e, tag)}
                            >
                                <div className="text-sm leading-[22px]">{tag.name}</div>
                                {isNumber(tag?.materialCount) && (
                                    <div className="text-[13px] leading-[18px] text-[var(--ant-basic-5)]">{tag?.materialCount}</div>
                                )}
                            </div>
                        );
                    }
                })}
                {isEditTag && (
                    <div
                        className="flex opacity-0"
                        style={{
                            visibility: 'hidden'
                        }}
                    >
                        <div
                            ref={editTagRef}
                            className="flex-shrink-0 gap-1 h-6 flex items-center bg-[var(--ant-basic-1)] text-[var(--ant-basic-7)] rounded border border-solid border-[var(--ant-basic-3)] px-2"
                        >
                            {isEditTag.name}
                        </div>
                    </div>
                )}
                {listInfo?.isLoading && (
                    <>
                        {Array.from(new Array(12)).map((_, index) => {
                            return <Skeleton key={index} className="h-6 w-[80px] rounded" />;
                        })}
                    </>
                )}
                {loadingMore && (
                    <>
                        {Array.from(new Array(6)).map((_, index) => {
                            return <Skeleton key={`loading-${index}`} className="h-6 w-[80px] rounded" />;
                        })}
                    </>
                )}
                {/* 用于 Intersection Observer 监听的元素 */}
                {hasMore && !loadingMore && listInfo && listInfo.tags.length > 0 && (
                    <div ref={loadMoreRef} className="w-full h-1" />
                )}
            </div>
            {contextMenu.visible && (
                <div
                    className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[120px]"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                        onClick={handleRename}
                    >
                        <Edit2Icon className="h-3 w-3" />
                        重命名
                    </button>
                    <button
                        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        onClick={() => selectedTag ? handleDelete(selectedTag) : undefined}
                    >
                        <Trash2Icon className="h-3 w-3" />
                        删除
                    </button>
                </div>
            )}
        </div>
    );
};