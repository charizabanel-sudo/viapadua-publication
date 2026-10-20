"use client";

import Image from "next/image";
import { useState } from "react";

export default function DeveloperPhoto({ name, src }: { name: string; src: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="developer-photo">
      {failed ? (
        <span aria-hidden="true">{name.charAt(0)}</span>
      ) : (
        <Image src={src} alt={name} width={100} height={100} sizes="100px" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
