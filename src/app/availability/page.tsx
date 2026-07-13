import { redirect } from "next/navigation";

export default function AvailabilityRedirect() {
  redirect("/settings/availability");
}
