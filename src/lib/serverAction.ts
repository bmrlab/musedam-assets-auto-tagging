// export class ServerActionError extends Error {
//   public readonly error: boolean = true;
//   constructor(
//     public message: string,
//     public code: string | null = null,
//   ) {
//     super(message);
//   }
// }

import { forbidden, notFound, unauthorized } from "next/navigation";

export type ServerActionResult<T> =
  | {
      success: true;
      data: T;
      pagination?: {
        page: number;
        pageSize: number;
        totalCount: number;
        totalPages: number;
      };
    }
  | {
      success: false;
      message: string;
      code?: "not_found" | "unauthorized" | "forbidden" | "internal_server_error";
    };

export function throwServerActionError(
  error: Extract<ServerActionResult<unknown>, { success: false }>,
): never {
  switch (error.code) {
    case "not_found":
      notFound();
    case "unauthorized":
      unauthorized();
    case "forbidden":
      forbidden();
    case "internal_server_error":
      throw new Error(error.message);
    default:
      throw new Error(error.message);
  }
}

// /**
//  * 从 ServerActionResult 中提取成功状态的数据类型
//  */
// export type ExtractServerActionData<T> = T extends ServerActionResult<infer U> ? U : never;

/**
 * 从 ServerAction 函数返回值中提取数据类型
 */
export type ExtractServerActionData<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends (...args: any[]) => Promise<ServerActionResult<any>>,
> = Extract<Awaited<ReturnType<T>>, { success: true }>["data"];
