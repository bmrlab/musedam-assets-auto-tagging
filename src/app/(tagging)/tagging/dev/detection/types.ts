export type DetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type DetectionUploadResult = {
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  detections: DetectionBox[];
  found: boolean;
  detectionLabelText: string;
};

export type DetectionImageUploadResult = {
  image: {
    objectKey: string;
    name: string;
    mimeType: string;
    size: number;
    uploadUrl: string;
    uploadUrlExpiresAt: number;
    signedUrl: string;
    signedUrlExpiresAt: number;
  };
};
