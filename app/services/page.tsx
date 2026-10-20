import { redirect } from "next/navigation";

export default async function ServicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams({ services: "1" });
  for (const key of ["service", "step"]) {
    const value = params[key];
    if (typeof value === "string") next.set(key, value);
  }
  redirect(`/?${next.toString()}`);
}
