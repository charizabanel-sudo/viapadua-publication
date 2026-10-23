import Link from "next/link";
import UserSignInMenu from "./UserSignInMenu";

/** Signed-in parishioners go to their portal; everyone else gets the floating sign-in card. */
export default function AccountLink({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
    <Link className="nav-btn" href="/portal">
      <i className="fas fa-user" aria-hidden="true" /> My portal
    </Link>
  ) : (
    <UserSignInMenu />
  );
}
