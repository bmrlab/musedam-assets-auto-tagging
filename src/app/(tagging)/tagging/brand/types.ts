export type BrandLogoTypeItem = {
  id: number;
  name: string;
  sort: number;
};

export type BrandTagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: BrandTagTreeNode[];
};

export type BrandLogoTagItem = {
  id: number;
  assetTagId: number | null;
  tagPath: string[];
};

export type BrandLogoImageItem = {
  id: number;
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  mimeType: string;
  size: number;
  sort: number;
};

export type BrandLogoItem = {
  id: number;
  slug: string;
  name: string;
  logoTypeId: number | null;
  logoTypeName: string;
  status: "pending" | "processing" | "completed" | "failed";
  enabled: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  images: BrandLogoImageItem[];
  tags: BrandLogoTagItem[];
};

export type BrandLibraryPageData = {
  logos: BrandLogoItem[];
  logoTypes: BrandLogoTypeItem[];
  tags: BrandTagTreeNode[];
};
