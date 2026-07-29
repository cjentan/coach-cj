import { redirect } from "next/navigation";

export default function DangerZoneRedirect() {
  redirect("/settings/data");
}
