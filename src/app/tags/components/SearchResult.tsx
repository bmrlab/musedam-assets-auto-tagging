import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SearchTagData, TagRecord } from "../types";

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

function resultPath(data: SearchTagData) {
  const path: string[] = [];
  for (let node: SearchTagData | undefined = data; node; node = node.parent) {
    path.unshift(node.tag.name);
  }
  return path.join(" > ");
}

export function SearchResult({
  searchData,
  handleClick,
}: {
  searchData: SearchTagData[];
  handleClick: (data: TagRecord) => void;
}) {
  const t = useTranslations("SearchResult");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const labels = useMemo(() => searchData.map(resultPath), [searchData]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil((viewportHeight || 480) / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(searchData.length, start + visibleCount);

  return (
    <div className="flex-1 min-w-0 bg-background border h-full rounded-md overflow-hidden flex flex-col">
      <div className="border-b px-4 py-2 font-medium leading-8">{t("tagGroup")}</div>
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto scrollbar-thin"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {searchData.length === 0 ? (
          <div className="w-full h-full flex justify-center items-center flex-col">
            <p className="text-sm text-basic-5">{t("noSearchResults")}</p>
          </div>
        ) : (
          <div className="relative" style={{ height: searchData.length * ROW_HEIGHT }}>
            <div className="absolute inset-x-0" style={{ top: start * ROW_HEIGHT }}>
              {searchData.slice(start, end).map((data, offset) => (
                <button
                  key={data.tag.id}
                  type="button"
                  className="flex h-9 w-full items-center px-4 text-left text-sm text-basic-7 hover:bg-primary-1 hover:text-primary-5"
                  onClick={() => handleClick(data.tag)}
                >
                  <span className="truncate">{labels[start + offset]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}