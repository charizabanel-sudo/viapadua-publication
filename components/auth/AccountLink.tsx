import Link from "next/link";
import { getCurrentUser } from "@/lib/server/user-auth";
export default async function AccountLink() {
  const user = await getCurrentUser();
  return (
    <Link className="nav-btn" href={user ? "/portal" : "/account/login"}>
      {user ? "My portal" : "Sign in"}
    </Link>
  );
}
