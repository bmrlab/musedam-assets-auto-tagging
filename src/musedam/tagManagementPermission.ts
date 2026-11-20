import "server-only";
import { z } from "zod";

/** 使用固定主站网关及真实用户会话，只读复用现有接口，不能从浏览器指定请求地址。 */
export async function assertMainSiteTagManagementPermission(input: {
  userId: string;
  teamId: string;
  token: string;
}) {
  const configured = process.env.MUSEDAM_WEB_API_BASE_URL;
  if (!configured) throw new Error("Main-site authorization gateway is not configured");
  const base = new URL(configured);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    throw new Error("Invalid main-site authorization gateway");
  const signal = AbortSignal.timeout(10_000);
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`${base.toString().replace(/\/$/, "")}/mini-dam-user${path}`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        "x-user-id": input.userId,
        "x-org-id": input.teamId,
        "x-token": input.token,
        ...(process.env.MUSEDAM_API_ENV_TAG
          ? { "x-asm-prefer-tag": process.env.MUSEDAM_API_ENV_TAG }
          : {}),
      },
    });
    if (!response.ok) throw new Error("Main-site permission check failed");
    const body = z
      .object({ code: z.union([z.string(), z.number()]), result: z.unknown().optional() })
      .parse(await response.json());
    if (String(body.code) !== "0") throw new Error("Main-site permission check failed");
    return body.result;
  };
  const [org, member] = await Promise.all([
    get(`/org/${input.teamId}`).then((value) =>
      z
        .object({
          id: z.union([z.string(), z.number()]),
          orgFeeType: z.number().int(),
          valid: z.boolean(),
        })
        .parse(value),
    ),
    get(`/org/members/${input.userId}`).then((value) =>
      z
        .object({
          userId: z.union([z.string(), z.number()]),
          roleId: z.union([z.string(), z.number()]).nullable(),
          accountStatusEnum: z.string(),
          isVisitor: z.boolean().optional(),
          visitor: z.boolean().optional(),
        })
        .parse(value),
    ),
  ]);
  if (
    String(org.id) !== input.teamId ||
    !org.valid ||
    String(member.userId) !== input.userId ||
    !["NORMAL", "ADMIN"].includes(member.accountStatusEnum) ||
    member.isVisitor === true ||
    member.visitor === true
  )
    throw new Error("No tag management permission");
  if (org.orgFeeType === 4) {
    const codes = z.array(z.string()).parse(await get("/orgRole/queryCurrentUserAuthCode"));
    if (!codes.includes("dam-material-admin-management-tag"))
      throw new Error("No tag management permission");
  } else {
    if (org.orgFeeType === 3 || member.roleId === null)
      throw new Error("No tag management permission");
    const roles = z
      .array(
        z.object({
          roleId: z.union([z.string(), z.number()]),
          authList: z.array(z.object({ authCode: z.string() })),
        }),
      )
      .parse(await get("/org/universal/role-auth"));
    const role = roles.find((item) => String(item.roleId) === String(member.roleId));
    if (!role?.authList.some((item) => item.authCode === "ORG_TAG_GROUP_MODIFY"))
      throw new Error("No tag management permission");
  }
}
