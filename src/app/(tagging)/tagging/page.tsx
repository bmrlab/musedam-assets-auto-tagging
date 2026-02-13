import { permanentRedirect } from "next/navigation";

export default async function TaggingPage() {
  permanentRedirect("/tagging/dashboard");
}
