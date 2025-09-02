// "use client";
// // import { dispatchMuseDAMClientAction } from "@/musedam/message";
// import { useEffect } from "react";
// export default function TaggingPage() {
//   useEffect(() => {
//     // dispatchMuseDAMClientAction("folder-selector-modal-open", {}).then((res) => {
//     //   console.log("res", res);
//     // });
//   }, []);
//   return <div>tagging</div>;
// }

import { permanentRedirect } from "next/navigation";

export default async function TaggingPage() {
  permanentRedirect("/tagging/dashboard");
}
