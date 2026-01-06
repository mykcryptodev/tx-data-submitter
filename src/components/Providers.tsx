"use client";

import { ThirdwebProvider } from "thirdweb/react";
import { client } from "@/lib/thirdweb";

interface ProvidersProps {
  children: React.ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ThirdwebProvider>
      {children}
    </ThirdwebProvider>
  );
}
