export const ASSET_IP_MATCH_PATTERNS = ["whole", "partial"] as const;

export type AssetIpMatchPattern = (typeof ASSET_IP_MATCH_PATTERNS)[number];

export const IP_PARTIAL_MATCH_PATTERN_OPTIONS = [
  "head",
  "face",
  "eye",
  "nose",
  "mouth",
  "ear",
  "hair",
  "hand",
  "feet",
  "body",
  "logo",
] as const;

export type IpPartialMatchPatternName = (typeof IP_PARTIAL_MATCH_PATTERN_OPTIONS)[number];

export const DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME: IpPartialMatchPatternName = "head";

export function isAssetIpMatchPattern(value: string): value is AssetIpMatchPattern {
  return ASSET_IP_MATCH_PATTERNS.includes(value as AssetIpMatchPattern);
}

export function isIpPartialMatchPatternName(value: string): value is IpPartialMatchPatternName {
  return IP_PARTIAL_MATCH_PATTERN_OPTIONS.includes(value as IpPartialMatchPatternName);
}
