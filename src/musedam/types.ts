export class MuseDAMID {
  private value: string;

  constructor(id: string | number | bigint) {
    this.value = String(id);
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }

  valueOf(): string {
    return this.value;
  }

  [Symbol.toPrimitive](): string {
    return this.value;
  }

  static from(id: string | number | bigint): MuseDAMID {
    return new MuseDAMID(id);
  }
}

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
