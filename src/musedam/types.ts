export enum TeamConfigName {
  musedamTeamApiKey = "musedamTeamApiKey",
  enableAutoTagging = "enableAutoTagging",
}

type TeamConfigNameTypes = keyof typeof TeamConfigName;

export type TeamConfigValue<T extends TeamConfigNameTypes> = T extends "musedamTeamApiKey"
  ? {
      apiKey: string;
      expiresAt: string;
    }
  : T extends "enableAutoTagging"
    ? boolean
    : never;
