import { redirect } from "next/navigation";

export default function BackupRestoreRedirect() {
  redirect("/settings/data");
}
