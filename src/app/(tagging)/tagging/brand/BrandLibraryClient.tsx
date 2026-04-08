"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

export default function BrandLibraryClient() {
  const t = useTranslations("Tagging.BrandLibrary");

  return (
    <div className="flex min-h-[620px] flex-1 flex-col py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-[28px] leading-[40px] font-semibold text-basic-8">{t("title")}</h2>
          <p className="mt-1 text-sm leading-5 text-basic-5">{t("description")}</p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-basic-5" />
            <Input className="h-10 rounded-[8px] pl-10" placeholder={t("searchPlaceholder")} />
          </div>

          <Button type="button" variant="outline" className="h-10 rounded-[8px] px-4">
            <Upload className="size-4" />
            {t("importExport")}
          </Button>

          <Button type="button" className="h-10 rounded-[8px] px-4">
            <Plus className="size-4" />
            {t("create")}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Image
            width={171}
            height={120}
            src="/emptyData.svg"
            alt=""
            className="mx-auto h-[120px] w-auto"
          />
          <p className="mt-4 text-sm leading-5 text-basic-5">{t("empty")}</p>
        </div>
      </div>
    </div>
  );
}
