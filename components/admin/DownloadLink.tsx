"use client";
import type { ReactNode } from "react";
import FileDownload, { CSV_TYPES } from "@/components/files/FileDownload";

/** Admin CSV export button (Records, Reports). */
export default function DownloadLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <FileDownload href={href} className={className} accept={CSV_TYPES} fallbackName="ViaPadua.csv">
      {children}
    </FileDownload>
  );
}
