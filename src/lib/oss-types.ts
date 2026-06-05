export type OssObjectLocation = {
  ossBucket: string;
  ossEndpoint: string;
  ossRegion: string;
};

export type OssObjectIdentity = OssObjectLocation & {
  objectKey: string;
};

export type UploadedOssImageInput = OssObjectIdentity & {
  mimeType: string;
  size: number;
};
