"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Sai e volta para o login. O mesmo caminho de antes: POST em
 * /api/auth/logout e navegacao inteira (sem cache do roteador).
 */
export async function sairDoAdmin() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  window.location.href = "/login";
}

export function AdminLogout({
  rotulo = "Sair",
  variant = "ghost",
  size = "sm",
  className,
}: {
  rotulo?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const [saindo, setSaindo] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      pending={saindo}
      className={className}
      onClick={() => {
        setSaindo(true);
        void sairDoAdmin();
      }}
    >
      {saindo ? null : <LogOut aria-hidden strokeWidth={1.75} />}
      {rotulo}
    </Button>
  );
}
