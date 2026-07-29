import { redirect } from "next/navigation";

export default function GoalsRedirect() {
  redirect("/settings/training");
}
