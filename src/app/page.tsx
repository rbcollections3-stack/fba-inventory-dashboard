import { redirect } from "next/navigation";
import { homeFor } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user.role) : "/login");
}
