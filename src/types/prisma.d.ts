declare module "@/prisma/client" {
  export * from "@/prisma/client/index";
  import { Tag } from "@/prisma/client";

  export type TagWithChildren = Pick<Tag, "id" | "name"> & {
    children?: TagWithChildren[];
  };
}
