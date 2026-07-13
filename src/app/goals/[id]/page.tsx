import { redirect } from "next/navigation";

export default function GoalsDetailRedirect() {
  redirect("/settings/goals");
}
