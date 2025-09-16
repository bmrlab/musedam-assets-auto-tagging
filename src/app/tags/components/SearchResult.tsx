import { FC } from "react";
import { SearchTagData, TagRecord } from "../types";



export const SearchResult: FC<{
    searchData: SearchTagData[]
    handleClick: (data: TagRecord) => void
}> = ({ searchData, handleClick }) => {
    return <div className="flex-1 bg-background border h-full rounded-md overflow-hidden flex flex-col">
        <div className="border-b px-4 py-2 font-medium">标签组</div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="flex gap-2.5 flex-wrap p-5">
                {searchData &&
                    Array.isArray(searchData) &&
                    searchData.map((data) => {
                        const third = data.tag;
                        const second = data.parent?.tag;
                        const first = data.parent?.parent?.tag;
                        return (
                            <div
                                key={data.tag.id}
                                className="flex-shrink-0 gap-1 h-6 flex items-center bg-[var(--ant-basic-1)] text-[var(--ant-basic-7)] rounded border border-solid border-[var(--ant-basic-3)] px-2 cursor-pointer hover:bg-[var(--ant-primary-1)] hover:border-[var(--ant-primary-5)] hover:text-[var(--ant-primary-5)] transition-all duration-300"
                                onClick={() => {
                                    handleClick(data.tag)
                                }}
                            >
                                <div className="text-sm leading-[22px] flex items-center">
                                    {first && first?.name}
                                    {first && (
                                        " > "
                                    )}
                                    {second && second?.name}
                                    {second && (
                                        " > "
                                    )}
                                    {third?.name}
                                </div>
                                {/* TODO 现在没有这个数据 */}
                                {/* {third.materialCount && (
                                    <div className="text-[13px] leading-[18px] text-[var(--ant-basic-5)]">
                                        {third.materialCount}
                                    </div>
                                )} */}
                            </div>
                        );
                    })}
            </div>
            {Array.isArray(searchData) && searchData.length === 0 && (
                <div className="w-full h-full flex justify-center items-center flex-col">
                    {/* <img src={emptyTagsSvg} className="w-[82px] h-[66px] mb-[12px]" /> */}
                    <p className="">搜索结果为空</p>
                </div>
            )}
        </div>
    </div>
}