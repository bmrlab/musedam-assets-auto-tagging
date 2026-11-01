"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getVisiblePageNumbers } from "@/lib/pagination";
import { useTranslations } from "next-intl";

type LibraryPaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

export default function LibraryPagination({
  currentPage,
  totalPages,
  onPageChange,
}: LibraryPaginationProps) {
  const tCommon = useTranslations("Tagging.Common");
  const visiblePages = getVisiblePageNumbers(currentPage, totalPages);

  return (
    <Pagination className="mx-0 w-auto">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={(event) => {
              event.preventDefault();
              if (currentPage > 1) {
                onPageChange(currentPage - 1);
              }
            }}
            disabled={currentPage <= 1}
            ariaLabel={tCommon("pagination.goToPreviousPage")}
          />
        </PaginationItem>

        {visiblePages.map((page) => (
          <PaginationItem key={page}>
            <PaginationLink
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onPageChange(page);
              }}
              isActive={currentPage === page}
            >
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}

        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={(event) => {
              event.preventDefault();
              if (currentPage < totalPages) {
                onPageChange(currentPage + 1);
              }
            }}
            disabled={currentPage >= totalPages}
            ariaLabel={tCommon("pagination.goToNextPage")}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
