import { MatchedKeywordsBadge } from "@/app/(tagging)/tagging/components/MatchedKeywordsBadge";
import messages from "@/app/(tagging)/messages/zh-CN.json";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("matched keyword badge", () => {
  it("hides the badge for historical results without keyword evidence", () => {
    const { container } = render(
      <NextIntlClientProvider locale="zh-CN" messages={messages}>
        <MatchedKeywordsBadge />
        <MatchedKeywordsBadge keywords={[]} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("displays the verified keywords and makes the full list available in the title", () => {
    const keywords = ["A+", "亚马逊", "很长的关键词".repeat(20)];
    render(
      <NextIntlClientProvider locale="zh-CN" messages={messages}>
        <MatchedKeywordsBadge keywords={keywords} />
      </NextIntlClientProvider>,
    );
    const label = `关键词：${keywords.join("、")}`;
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByTitle(label)).toBeTruthy();
  });
});
