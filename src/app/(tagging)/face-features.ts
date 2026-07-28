import type { TaggingFaceFeatures } from "@/prisma/client";

export function buildFaceFeaturesPromptSection(
  faceFeatures: TaggingFaceFeatures | undefined,
): string {
  if (!faceFeatures) {
    return "";
  }

  return `

## faceFeatures辅助信号（特征识别）
检测到的人脸数量：${faceFeatures.faceCount}
是否检测到人脸：${faceFeatures.found ? "是" : "否"}
说明：以上来自人脸特征识别，不是独立输出 source。若标签体系中存在与人物数量、人像/肖像相关的标签，可据此提高或降低相关预测置信度；否则忽略。`;
}
