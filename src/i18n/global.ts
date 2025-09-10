import messages from "../../messages/zh-CN.json";
import taggingMessages from "../app/(tagging)/messages/zh-CN.json";
import { locales } from "./routing";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    // https://next-intl.dev/docs/workflows/typescript#messages
    Messages: typeof messages & typeof taggingMessages;
  }
}
