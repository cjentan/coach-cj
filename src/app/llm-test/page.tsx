import { redirect } from "next/navigation";

export default function LlmTestRedirect() {
  redirect("/settings/credentials");
}
