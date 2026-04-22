export type IpTypeItem = {
  id: string;
  name: string;
  sort: number;
};

export type IpTagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: IpTagTreeNode[];
};

export type IpTagItem = {
  id: string;
  assetTagId: number | null;
  tagPath: string[];
};

export type IpImageItem = {
  id: string;
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  mimeType: string;
  size: number;
  sort: number;
};

export type IpItem = {
  id: string;
  slug: string;
  name: string;
  ipTypeId: string | null;
  ipTypeName: string;
  description: string;
  status: "pending" | "processing" | "completed" | "failed";
  processingError: string | null;
  processedAt: Date | null;
  enabled: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  images: IpImageItem[];
  tags: IpTagItem[];
};

export type IpLibraryPageData = {
  ips: IpItem[];
  ipTypes: IpTypeItem[];
  tags: IpTagTreeNode[];
};

export type IpDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type IpClassificationUploadResult = {
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  detections: IpDetectionBox[];
  found: boolean;
};

export type IpClassificationMatch = {
  assetIpId: string;
  ipName: string;
  ipTypeId: string | null;
  ipTypeName: string;
  description: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: IpTagItem[];
};

export type IpClassificationResult = {
  topMatches: IpClassificationMatch[];
  bestMatch: IpClassificationMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
};
